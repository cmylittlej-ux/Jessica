import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { getI18n } from "./_lib/i18n";
import { setLanguageAction } from "./actions";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "REOS — Real Estate AI OS",
  description: "Melbourne real estate sales & property management AI operating system (Foundation MVP, mock data)",
};

const NAV = [
  { href: "/", key: "nav.home" },
  { href: "/inbox", key: "nav.inbox" },
  { href: "/tasks", key: "nav.tasks" },
  { href: "/approvals", key: "nav.approvals" },
  { href: "/properties", key: "nav.properties" },
] as const;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { lang, t } = await getI18n();

  return (
    <html lang={lang === "zh" ? "zh-CN" : "en"}>
      <body
        className={`${geistSans.variable} antialiased bg-neutral-50 text-neutral-900`}
      >
        <div className="flex min-h-screen">
          {/* Sidebar — neutral, compact, keyboard-friendly (Spec §17) */}
          <aside className="w-52 shrink-0 border-r border-neutral-200 bg-white flex-col fixed inset-y-0 hidden md:flex">
            <div className="px-4 py-5 border-b border-neutral-200">
              <div className="text-sm font-semibold tracking-tight">REOS</div>
              <div className="text-[11px] text-neutral-500">Foundation MVP · Mock</div>
            </div>
            <nav aria-label="Main" className="p-2 space-y-0.5">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block rounded-md px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-900"
                >
                  {t[item.key]}
                </Link>
              ))}
            </nav>
            <div className="mt-auto px-4 py-4 text-[10px] leading-relaxed text-neutral-400 border-t border-neutral-200">
              {t["layout.footer1"]}
              <br />
              {t["layout.footer2"]}
            </div>
          </aside>

          {/* Top bar — real 中文|EN switch (Spec §25): cookie-only, never
              touches business state (Phase 6 gate). On small screens the
              sidebar hides and a horizontal nav row appears instead. */}
          <div className="flex-1 flex flex-col min-w-0 md:ml-52">
            <header className="h-12 shrink-0 border-b border-neutral-200 bg-white flex items-center justify-between px-4 md:px-6 sticky top-0 z-10">
              <div className="text-xs text-neutral-500 truncate">{t["layout.subtitle"]}</div>
              <form action={setLanguageAction} className="flex items-center gap-1 text-xs">
                <button
                  name="lang"
                  value="en"
                  className={`rounded px-2.5 py-1 font-medium border ${
                    lang === "en"
                      ? "bg-neutral-900 text-white border-neutral-900"
                      : "border-neutral-300 text-neutral-500 hover:bg-neutral-100"
                  }`}
                >
                  EN
                </button>
                <span className="text-neutral-300">|</span>
                <button
                  name="lang"
                  value="zh"
                  className={`rounded px-2.5 py-1 font-medium border ${
                    lang === "zh"
                      ? "bg-neutral-900 text-white border-neutral-900"
                      : "border-neutral-300 text-neutral-500 hover:bg-neutral-100"
                  }`}
                >
                  中文
                </button>
              </form>
            </header>
            {/* Mobile navigation (sidebar is md+) */}
            <nav
              aria-label="Main mobile"
              className="md:hidden flex gap-1 overflow-x-auto border-b border-neutral-200 bg-white px-3 py-2 sticky top-12 z-10"
            >
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="whitespace-nowrap rounded-md border border-neutral-200 px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-100"
                >
                  {t[item.key]}
                </Link>
              ))}
            </nav>
            <main className="flex-1">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
