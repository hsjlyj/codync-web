'use client'

/**
 * 终端路由（Phase 3）：`?backend=<id>&step=install|login`——静态导出（output: export）
 * 不支持动态路由段，参数一律走查询串（同 bots/edit）。主机 agentSetup 启动安装/登录
 * 终端，输出经 `/term` 订阅加密下发（需 control scope）。
 */
import { Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { appModel } from '@/src/client/store/app-model'
import { useAppModel } from '@/src/client/use-app-model'
import { TerminalView } from '@/src/client/views/terminal/TerminalView'

function TerminalRoute() {
  const snap = useAppModel()
  const params = useSearchParams()
  const backend = params.get('backend')?.trim() || 'claude-code'
  const step = params.get('step') === 'login' ? 'login' : 'install'
  const transport = appModel.transport()

  if (snap.connection !== 'open' || !transport) {
    return (
      <div className="p-6 text-sm text-neutral-400">
        终端需要先连接主机（演示模式即可体验）。
        <Link href="/client" className="ml-2 text-emerald-400 hover:underline">
          去连接
        </Link>
      </div>
    )
  }

  return (
    <>
      <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2.5">
        <h1 className="text-sm font-semibold text-neutral-200">终端</h1>
        <span className="text-xs text-neutral-500">
          {backend} · {step === 'login' ? '登录' : '安装'}
        </span>
        <span className="flex-1" />
        <Link href="/client/chat" className="text-xs text-neutral-400 hover:text-neutral-200">
          回聊天
        </Link>
      </header>
      <TerminalView transport={transport} backend={backend} step={step} />
    </>
  )
}

export default function TerminalPage() {
  return (
    <main className="flex h-dvh flex-col bg-neutral-950 text-neutral-100">
      <Suspense fallback={<p className="p-6 text-sm text-neutral-500">读取中…</p>}>
        <TerminalRoute />
      </Suspense>
    </main>
  )
}
