'use client'

/**
 * 屏幕查看路由（Phase 3 骨架）：主机画面经 WebRTC 查看（screenPrepare/screenOffer 信令、
 * screenCandidates 订阅收 ICE）。screen* 方法需要设备的 Screen scope（devices.rs:90），
 * 无权限时主机回 403，视图给明确文案。静态导出：本页无参数。
 */
import { Suspense } from 'react'
import Link from 'next/link'
import { appModel } from '@/src/client/store/app-model'
import { useAppModel } from '@/src/client/use-app-model'
import { ScreenShareView } from '@/src/client/views/screen/ScreenShareView'

function ScreenRoute() {
  const snap = useAppModel()
  const transport = appModel.transport()

  if (snap.connection !== 'open' || !transport) {
    return (
      <div className="p-6 text-sm text-neutral-400">
        屏幕查看需要先连接主机（演示模式即可体验信令流程）。
        <Link href="/client" className="ml-2 text-emerald-400 hover:underline">
          去连接
        </Link>
      </div>
    )
  }

  return (
    <>
      <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2.5">
        <h1 className="text-sm font-semibold text-neutral-200">屏幕</h1>
        <span className="text-xs text-neutral-500">{snap.hello?.name ?? ''}</span>
        <span className="flex-1" />
        <Link href="/client/chat" className="text-xs text-neutral-400 hover:text-neutral-200">
          回聊天
        </Link>
      </header>
      <ScreenShareView transport={transport} />
    </>
  )
}

export default function ScreenPage() {
  return (
    <main className="flex h-dvh flex-col bg-neutral-950 text-neutral-100">
      <Suspense fallback={<p className="p-6 text-sm text-neutral-500">读取中…</p>}>
        <ScreenRoute />
      </Suspense>
    </main>
  )
}
