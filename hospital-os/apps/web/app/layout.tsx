import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "@/components/Shell";

export const metadata: Metadata = {
  title: "Hospital OS",
  description: "MVP perioperatório — ambiente de demonstração com dados sintéticos.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="border-b border-amber-300 bg-amber-100 px-4 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-amber-900">
          Ambiente de demonstração — dados 100% sintéticos. Não usar para assistência.
        </div>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
