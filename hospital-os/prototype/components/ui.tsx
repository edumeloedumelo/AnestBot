"use client";

import { useState, type ReactNode } from "react";
import type { Paciente } from "@/lib/data";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>;
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

export function Chip({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

/**
 * Alerta graduado: severidade sempre com ícone + rótulo textual, nunca cor
 * sozinha (docs/SECURITY.md §5).
 */
export function Alerta({ nivel, children }: { nivel: "info" | "atencao" | "critico"; children: ReactNode }) {
  const cfg = {
    info: { cls: "border-sky-300 bg-sky-50 text-sky-900", icone: "ℹ", rotulo: "Informativo" },
    atencao: { cls: "border-amber-300 bg-amber-50 text-amber-900", icone: "⚠", rotulo: "Atenção" },
    critico: { cls: "border-rose-300 bg-rose-50 text-rose-900", icone: "⛔", rotulo: "Crítico" },
  }[nivel];
  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${cfg.cls}`}>
      <span aria-hidden>{cfg.icone}</span>
      <span>
        <strong className="mr-1">{cfg.rotulo}:</strong>
        {children}
      </span>
    </div>
  );
}

/** Identificação positiva do paciente — presente em toda tela clínica. */
export function PatientBanner({ paciente }: { paciente: Paciente }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 shadow-sm">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-600" aria-hidden>
        {paciente.nome.slice(0, 1)}
      </div>
      <div>
        <div className="font-semibold leading-tight">{paciente.nome}</div>
        <div className="text-xs text-slate-500">
          Nasc. {paciente.nascimento} ({paciente.idade} a) · Prontuário {paciente.prontuario} · {paciente.convenio}
        </div>
      </div>
      {paciente.alergias.length > 0 ? (
        <Chip className="border-rose-300 bg-rose-50 text-rose-800">⚠ Alergias: {paciente.alergias.join(", ")}</Chip>
      ) : (
        <Chip className="border-slate-300 bg-slate-50 text-slate-600">Sem alergias registradas</Chip>
      )}
    </div>
  );
}

/** "ⓘ" do dicionário de indicadores: definição, fórmula, fonte, limitações. */
export function InfoDicionario(props: { definicao: string; formula: string; fonte: string; periodo: string; limitacoes: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        type="button"
        aria-label="Definição do indicador"
        onClick={() => setAberto(!aberto)}
        className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 text-[11px] text-slate-500 hover:bg-slate-100"
      >
        i
      </button>
      {aberto && (
        <div className="absolute right-0 z-20 mt-1 w-72 rounded-md border border-slate-300 bg-white p-3 text-left text-xs shadow-lg">
          <dl className="space-y-1.5">
            <div><dt className="font-semibold text-slate-700">Definição</dt><dd className="text-slate-600">{props.definicao}</dd></div>
            <div><dt className="font-semibold text-slate-700">Fórmula</dt><dd className="text-slate-600">{props.formula}</dd></div>
            <div><dt className="font-semibold text-slate-700">Fonte</dt><dd className="text-slate-600">{props.fonte}</dd></div>
            <div><dt className="font-semibold text-slate-700">Período</dt><dd className="text-slate-600">{props.periodo}</dd></div>
            <div><dt className="font-semibold text-slate-700">Limitações</dt><dd className="text-slate-600">{props.limitacoes}</dd></div>
          </dl>
        </div>
      )}
    </span>
  );
}
