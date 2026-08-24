import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "REOS — Real Estate AI OS",
  description: "Melbourne real estate sales & property management AI operating system (Foundation MVP, mock data)",
};

const NAV = [
  { href: "/", label: "AI Home", zh: "AI 首页" },
  { href: "/inbox", label: "AI Inbox", zh: "AI 收件箱" },
  { href: "/tasks", label: "Tasks", zh: "任务" },
  { href: "/approvals", label: "Approvals", zh: "审批" },
  { href: "/properties", label: "Properties", zh: "房产" },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} antialiased bg-neutral-50 text-neutral-900`}
      >
        <div className="flex min-h-screen">
          {/* Sidebar — neutral, compact, keyboard-friendly (Spec §17) */}
          <aside className="w-52 shrink-0 border-r border-neutral-200 bg-white flex flex-col fixed inset-y-0">
            <div className="px-4 py-5 border-b border-neutral-200">
              <div className="text-sm font-semibold tracking-tight">REOS</div>
              <div className="text-[11px] text-neutral-500">Foundation MVP · Mock</div>
            </div>
            <nav className="p-2 space-y-0.5">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block rounded-md px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900"
                >
                  {item.label}
                  <span className="ml-1.5 text-[11px] text-neutral-400">{item.zh}</span>
                </Link>
              ))}
            </nav>
            <div className="mt-auto px-4 py-4 text-[10px] leading-relaxed text-neutral-400 border-t border-neutral-200">
              Local-only · Mock data
              <br />
              No real APIs connected
            </div>
          </aside>

          {/* Top bar with bilingual placeholder toggle (full UX in Phase 6) */}
          <div className="flex-1 flex flex-col min-w-0 ml-52">
            <header className="h-12 shrink-0 border-b border-neutral-200 bg-white flex items-center justify-between px-6 sticky top-0 z-10">
              <div className="text-xs text-neutral-500">
                Real Estate AI Operating System — Melbourne
              </div>
              <div className="flex items-center gap-2 text-xs">
                <button className="rounded border border-neutral-300 px-2 py-1 font-medium">EN</button>
                <span className="text-neutral-300">|</span>
                <button className="rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100">中文</button>
              </div>
            </header>
            <main className="flex-1">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
