"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getSession, setSession, type Session } from "@/lib/api";

const itens = [
  { href: "/mapa", rotulo: "Mapa cirúrgico" },
  { href: "/pacientes", rotulo: "Pacientes" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setLocal] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const current = getSession();
    setLocal(current);
    setReady(true);
    if (!current && pathname !== "/login") {
      router.replace("/login");
    }
  }, [pathname, router]);

  if (!ready) return null;
  if (pathname === "/login") return <main className="mx-auto max-w-md p-6">{children}</main>;
  if (!session) return null;

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-slate-50 md:block">
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="text-base font-bold text-slate-900">Hospital OS</div>
          <div className="text-xs text-slate-500">{session.fullName}</div>
        </div>
        <nav className="flex flex-col gap-0.5 p-2" aria-label="Módulos">
          {itens.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={pathname === item.href ? "page" : undefined}
              className={`rounded-md px-3 py-2 text-sm font-medium ${
                pathname === item.href ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-200"
              }`}
            >
              {item.rotulo}
            </Link>
          ))}
          <button
            onClick={() => {
              setSession(null);
              router.push("/login");
            }}
            className="mt-2 rounded-md px-3 py-2 text-left text-sm font-medium text-slate-500 hover:bg-slate-200"
          >
            Sair
          </button>
        </nav>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}
