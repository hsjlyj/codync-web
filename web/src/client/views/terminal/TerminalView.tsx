'use client'

/**
 * 终端视图（Phase 3）：xterm.js 渲染与键盘交互；会话 I/O 在 TerminalController。
 * xterm 只在浏览器可用（动态 import；Next 静态导出的预渲染无 DOM，不会执行）。
 * 资源清理（新刃审查红线）：unmount → controller.stop()（cancel 订阅 + termClose）→ term.dispose()；
 * 「重新打开」以 runId 重跑 effect，先走同一套清理再重建。
 */
import { useEffect, useRef, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import { TerminalController, type TerminalStage } from '../../store/terminal'
import type { HostTransport } from '../../transport/host-transport'

const STAGE_TEXT: Record<TerminalStage, string> = {
  starting: '正在创建终端…',
  running: '已连接',
  exited: '进程已退出',
  failed: '终端已断开',
}

export function TerminalView({
  transport,
  backend,
  step,
}: {
  transport: HostTransport
  backend: string
  step: 'install' | 'login'
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<TerminalStage>('starting')
  const [detail, setDetail] = useState<string | null>(null)
  const [runId, setRunId] = useState(0)

  useEffect(() => {
    let disposed = false
    const cleanups: (() => void)[] = []
    let term: Terminal | null = null
    void (async () => {
      const [{ Terminal: XTerm }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/addon-web-links'),
      ])
      if (disposed || !containerRef.current) return
      term = new XTerm({
        cursorBlink: true,
        fontSize: 13,
        scrollback: 5000,
        theme: { background: '#0a0a0a', foreground: '#e5e5e5', cursor: '#34d399' },
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.loadAddon(new WebLinksAddon())
      term.open(containerRef.current)
      const fitNow = () => {
        try {
          fit.fit()
        } catch {
          /* 容器尚无尺寸（隐藏/过渡态）时跳过，下次 resize 再试 */
        }
      }
      fitNow()
      const observer = new ResizeObserver(fitNow)
      observer.observe(containerRef.current)
      cleanups.push(() => observer.disconnect())

      const controller = new TerminalController(transport, {
        onOutput: (chunk) => term?.write(chunk),
        onStage: (next, message) => {
          setStage(next)
          setDetail(message ?? null)
        },
      })
      cleanups.push(() => controller.stop())
      term.onData((data) => controller.write(data))
      term.onResize(({ cols, rows }) => controller.resize(cols, rows))
      await controller.start({ backend, step, cols: term.cols, rows: term.rows })
    })()
    return () => {
      disposed = true
      for (const cleanup of cleanups) cleanup()
      term?.dispose()
    }
  }, [transport, backend, step, runId])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={containerRef} className="min-h-0 flex-1 px-2 py-1" role="region" aria-label="终端输出" />
      <div className="flex items-center gap-2 border-t border-neutral-800 px-4 py-1.5 text-xs">
        <span
          aria-live="polite"
          className={
            stage === 'running' ? 'text-emerald-400' : stage === 'failed' ? 'text-red-400' : 'text-neutral-400'
          }
        >
          {STAGE_TEXT[stage]}
          {detail ? `（${detail}）` : ''}
        </span>
        <span className="flex-1" />
        {(stage === 'exited' || stage === 'failed') && (
          <button
            type="button"
            onClick={() => {
              setStage('starting')
              setDetail(null)
              setRunId((n) => n + 1)
            }}
            className="rounded-lg bg-neutral-800 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
          >
            重新打开
          </button>
        )}
      </div>
    </div>
  )
}
