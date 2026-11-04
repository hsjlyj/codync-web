'use client'

/**
 * 屏幕查看视图（Phase 3 骨架）：video 播放主机推来的视频轨；信令 I/O 在 ScreenSession。
 * 资源清理（新刃审查红线）：unmount → session.stop()（退订 + screenClose + pc.close()），
 * srcObject 一并释放；「重新连接」以 runId 重跑 effect 走同一套清理。
 */
import { useEffect, useRef, useState } from 'react'
import { ScreenSession, type ScreenStage } from '../../store/screen-view'
import type { HostTransport } from '../../transport/host-transport'

const STAGE_TEXT: Record<ScreenStage, string> = {
  idle: '准备中…',
  preparing: '正在准备屏幕会话…',
  connecting: '正在建立连接…',
  connected: '正在查看',
  closed: '已断开',
  failed: '连接失败',
}

export function ScreenShareView({ transport }: { transport: HostTransport }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [stage, setStage] = useState<ScreenStage>('idle')
  const [detail, setDetail] = useState<string | null>(null)
  const [runId, setRunId] = useState(0)
  const sessionRef = useRef<ScreenSession | null>(null)

  useEffect(() => {
    const video = videoRef.current
    const session = new ScreenSession(transport, {
      onStage: (next, message) => {
        setStage(next)
        setDetail(message ?? null)
      },
      onStream: (stream) => {
        if (video) video.srcObject = stream
      },
    })
    sessionRef.current = session
    void session.start()
    return () => {
      sessionRef.current = null
      session.stop()
      if (video) video.srcObject = null
    }
  }, [transport, runId])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`max-h-full max-w-full rounded-xl border border-neutral-800 bg-black ${
            stage === 'connected' ? '' : 'hidden'
          }`}
          aria-label="主机屏幕画面"
        />
        {stage !== 'connected' && (
          <p aria-live="polite" className="text-sm text-neutral-500">
            {stage === 'failed' && detail ? `${STAGE_TEXT[stage]}：${detail}` : STAGE_TEXT[stage]}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-neutral-800 px-4 py-1.5 text-xs">
        <span className={stage === 'failed' ? 'text-red-400' : 'text-neutral-400'}>{STAGE_TEXT[stage]}</span>
        <span className="flex-1" />
        {(stage === 'connected' || stage === 'connecting' || stage === 'preparing') && (
          <button
            type="button"
            onClick={() => sessionRef.current?.stop()}
            className="rounded-lg bg-red-600/80 px-3 py-1 text-xs text-white hover:bg-red-500"
          >
            断开查看
          </button>
        )}
        {(stage === 'closed' || stage === 'failed') && (
          <button
            type="button"
            onClick={() => {
              setStage('idle')
              setDetail(null)
              setRunId((n) => n + 1)
            }}
            className="rounded-lg bg-neutral-800 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
          >
            重新连接
          </button>
        )}
      </div>
    </div>
  )
}
