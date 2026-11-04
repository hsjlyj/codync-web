import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Codync Web 客户端",
  robots: { index: false, follow: false }
};

// 站点根路径直接进入 Web 客户端；静态导出（output: "export"）下
// 用 meta refresh 立即跳转，并附兜底链接。
export default function Home() {
  return (
    <>
      <meta httpEquiv="refresh" content="0; url=/client" />
      <main className="flex min-h-screen flex-1 items-center justify-center bg-neutral-950">
        <a href="/client" className="text-neutral-50 underline underline-offset-4">
          正在进入 Web 客户端，若未自动跳转请点击这里
        </a>
      </main>
    </>
  );
}
