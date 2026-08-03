import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "Hospital OS — Protótipo",
  description: "Protótipo navegável do MVP perioperatório. Dados 100% sintéticos.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="border-b border-amber-300 bg-amber-100 px-4 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-amber-900">
          Protótipo — dados 100% sintéticos, sem persistência. Não usar para assistência.
        </div>
        <div className="flex min-h-screen">
          <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-slate-50 md:block">
            <div className="border-b border-slate-200 px-4 py-3">
              <div className="text-base font-bold text-slate-900">Hospital OS</div>
              <div className="text-xs text-slate-500">Centro Cirúrgico · Unidade Teste</div>
            </div>
            <Nav />
          </aside>
          <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
