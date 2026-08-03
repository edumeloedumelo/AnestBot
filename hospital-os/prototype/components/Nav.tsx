"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const itens = [
  { href: "/", rotulo: "Dashboard do dia" },
  { href: "/mapa", rotulo: "Mapa cirúrgico" },
  { href: "/agendamento", rotulo: "Agendamento" },
  { href: "/pacientes", rotulo: "Pacientes" },
  { href: "/pre-anestesica", rotulo: "Avaliação pré-anestésica" },
  { href: "/ficha", rotulo: "Ficha anestésica" },
  { href: "/rpa", rotulo: "Recuperação (RPA)" },
  { href: "/relatorios", rotulo: "Relatórios" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5 p-2" aria-label="Módulos">
      {itens.map((item) => {
        const ativo = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={ativo ? "page" : undefined}
            className={`rounded-md px-3 py-2 text-sm font-medium ${
              ativo ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-200"
            }`}
          >
            {item.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
