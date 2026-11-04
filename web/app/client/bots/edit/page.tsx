'use client'

/**
 * 编辑 Bot 路由（?bot=<id>）：静态导出（output: export）不支持无 generateStaticParams 的
 * 动态路由段（Bot id 来自运行中的主机，无法枚举），所以用查询参数 + useSearchParams；
 * useSearchParams 在预渲染期需 Suspense 边界。
 */
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { BotEditor } from '@/src/client/views/bots/BotEditor'

function BotEditorRoute() {
  const params = useSearchParams()
  return <BotEditor botId={params.get('bot') ?? ''} />
}

export default function BotEditPage() {
  return (
    <main className="flex min-h-dvh items-start justify-center p-6">
      <Suspense fallback={<p className="text-sm text-neutral-500">读取中…</p>}>
        <BotEditorRoute />
      </Suspense>
    </main>
  )
}
