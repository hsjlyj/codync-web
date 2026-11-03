import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Web Client',
  description: 'Codync Web 客户端：浏览器直连主机 /channel E2E（ADR-001）',
}

/** 客户端外壳：独占视口，不渲染营销页的任何内容（根布局只提供 html/body 与全局样式）。 */
export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return <div className="h-dvh bg-neutral-950 text-neutral-200">{children}</div>
}
