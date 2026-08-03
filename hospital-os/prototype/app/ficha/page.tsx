"use client";

import { useState } from "react";
import { Card, PageHeader, Chip, PatientBanner } from "@/components/ui";
import { pacientes, hora } from "@/lib/data";

type TipoEvento = "droga" | "fluido" | "marco" | "clinico";

type Evento = {
  id: number;
  t: number; // minutos desde 00:00
  tipo: TipoEvento;
  texto: string;
  retroativo?: boolean;
};

const INICIO = 8 * 60; // caso começa 08:00
const AGORA = 9 * 60 + 20; // "agora" simulado: 09:20

const eventosIniciais: Evento[] = [
  { id: 1, t: INICIO, tipo: "marco", texto: "Entrada em sala" },
  { id: 2, t: INICIO + 6, tipo: "marco", texto: "Monitorização completa" },
  { id: 3, t: INICIO + 10, tipo: "droga", texto: "Propofol 150 mg EV" },
  { id: 4, t: INICIO + 10, tipo: "droga", texto: "Fentanil 200 mcg EV" },
  { id: 5, t: INICIO + 12, tipo: "droga", texto: "Rocurônio 40 mg EV" },
  { id: 6, t: INICIO + 15, tipo: "marco", texto: "Intubação orotraqueal — TOT 7,5" },
  { id: 7, t: INICIO + 25, tipo: "marco", texto: "Incisão cirúrgica" },
  { id: 8, t: INICIO + 40, tipo: "fluido", texto: "Ringer lactato 500 mL" },
  { id: 9, t: INICIO + 55, tipo: "clinico", texto: "Hipotensão transitória — efedrina 10 mg EV, revertida" },
];

const drogasRapidas = ["Propofol", "Fentanil", "Rocurônio", "Efedrina", "Cefazolina", "Dipirona", "Ondansetrona"];
const dosesPorDroga: Record<string, string[]> = {
  Propofol: ["50 mg", "100 mg", "150 mg", "200 mg"],
  Fentanil: ["50 mcg", "100 mcg", "200 mcg"],
  Rocurônio: ["10 mg", "40 mg", "50 mg"],
  Efedrina: ["5 mg", "10 mg"],
  Cefazolina: ["1 g", "2 g"],
  Dipirona: ["1 g", "2 g"],
  Ondansetrona: ["4 mg", "8 mg"],
};
const marcosRapidos = ["Indução", "Intubação", "Incisão", "Fim da cirurgia", "Extubação", "Saída de sala"];

const corTipo: Record<TipoEvento, { rotulo: string; cls: string; ponto: string }> = {
  droga: { rotulo: "Droga", cls: "border-blue-300 bg-blue-50 text-blue-900", ponto: "bg-blue-600" },
  fluido: { rotulo: "Fluido", cls: "border-cyan-300 bg-cyan-50 text-cyan-900", ponto: "bg-cyan-600" },
  marco: { rotulo: "Marco", cls: "border-slate-300 bg-slate-100 text-slate-700", ponto: "bg-slate-600" },
  clinico: { rotulo: "Evento clínico", cls: "border-amber-300 bg-amber-50 text-amber-900", ponto: "bg-amber-500" },
};

export default function FichaPage() {
  const paciente = pacientes[2];
  const [eventos, setEventos] = useState(eventosIniciais);
  const [drogaSel, setDrogaSel] = useState<string | null>(null);
  const [retroMin, setRetroMin] = useState(0);

  const fimJanela = AGORA + 20;

  function adicionar(tipo: TipoEvento, texto: string) {
    const t = AGORA - retroMin;
    setEventos([...eventos, { id: Date.now(), t, tipo, texto, retroativo: retroMin > 0 }].sort((a, b) => a.t - b.t));
    setDrogaSel(null);
    setRetroMin(0);
  }

  return (
    <div>
      <PageHeader
        title="Ficha anestésica"
        subtitle="Mamoplastia redutora · Sala 2 · Dra. Teste Rocha · Anestesia geral balanceada"
      >
        <Chip className="border-emerald-300 bg-emerald-50 text-emerald-800">Em andamento — {hora(AGORA)} (simulado)</Chip>
        <button className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm">Exportar PDF (simulado)</button>
      </PageHeader>
      <PatientBanner paciente={paciente} />

      <Card className="mb-4 overflow-x-auto p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-800">Linha temporal</h2>
        <div className="relative min-w-[700px]" style={{ height: 120 }}>
          {Array.from({ length: Math.floor((fimJanela - INICIO) / 15) + 1 }, (_, i) => {
            const t = INICIO + i * 15;
            const x = ((t - INICIO) / (fimJanela - INICIO)) * 100;
            return (
              <div key={t} className="absolute top-0 h-full border-l border-slate-100" style={{ left: `${x}%` }}>
                <span className="absolute -top-0.5 -translate-x-1/2 text-[10px] text-slate-400">{t % 30 === 0 ? hora(t) : ""}</span>
              </div>
            );
          })}
          <div
            className="absolute top-0 h-full border-l-2 border-rose-400"
            style={{ left: `${((AGORA - INICIO) / (fimJanela - INICIO)) * 100}%` }}
            aria-label="Agora"
          >
            <span className="absolute -top-0.5 ml-1 text-[10px] font-semibold text-rose-500">agora</span>
          </div>
          {eventos.map((e, i) => {
            const x = ((e.t - INICIO) / (fimJanela - INICIO)) * 100;
            const linha = i % 3;
            return (
              <div key={e.id} className="absolute -translate-x-1/2" style={{ left: `${x}%`, top: 24 + linha * 32 }} title={`${hora(e.t)} — ${e.texto}`}>
                <div className={`mx-auto h-2.5 w-2.5 rounded-full ring-2 ring-white ${corTipo[e.tipo].ponto}`} />
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex gap-2 text-xs text-slate-500">
          {Object.values(corTipo).map((c) => (
            <span key={c.rotulo} className="flex items-center gap-1">
              <span className={`h-2 w-2 rounded-full ${c.ponto}`} /> {c.rotulo}
            </span>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <Card className="h-fit p-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-800">Registro rápido</h2>
          <p className="mb-3 text-xs text-slate-500">Droga → dose: 2 toques. Registro retroativo é marcado como tal na ficha.</p>

          {!drogaSel ? (
            <div className="flex flex-wrap gap-1.5">
              {drogasRapidas.map((d) => (
                <button key={d} onClick={() => setDrogaSel(d)} className="rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-900 hover:bg-blue-100">
                  {d}
                </button>
              ))}
            </div>
          ) : (
            <div>
              <div className="mb-2 text-sm text-slate-700">
                <strong>{drogaSel}</strong> — selecione a dose:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {dosesPorDroga[drogaSel].map((dose) => (
                  <button key={dose} onClick={() => adicionar("droga", `${drogaSel} ${dose} EV`)} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                    {dose}
                  </button>
                ))}
                <button onClick={() => setDrogaSel(null)} className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600">
                  Cancelar
                </button>
              </div>
            </div>
          )}

          <h3 className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Marcos</h3>
          <div className="flex flex-wrap gap-1.5">
            {marcosRapidos.map((m) => (
              <button key={m} onClick={() => adicionar("marco", m)} className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
                {m}
              </button>
            ))}
          </div>

          <h3 className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Momento do registro</h3>
          <div className="flex flex-wrap gap-1.5">
            {[0, 5, 10, 15].map((m) => (
              <button
                key={m}
                onClick={() => setRetroMin(m)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
                  retroMin === m ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-600"
                }`}
              >
                {m === 0 ? "Agora" : `há ${m} min`}
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-800">Eventos registrados</h2>
          <ul className="space-y-1.5">
            {[...eventos].reverse().map((e) => (
              <li key={e.id} className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm ${corTipo[e.tipo].cls}`}>
                <span className="font-mono text-xs">{hora(e.t)}</span>
                <Chip className="border-current bg-white/60">{corTipo[e.tipo].rotulo}</Chip>
                <span>{e.texto}</span>
                {e.retroativo && <Chip className="border-slate-400 bg-white text-slate-600">registro retroativo</Chip>}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            Na versão real: toda edição gera versão auditada; sinais vitais de monitores entram como fonte identificada (Fase 3), nunca sobrescrevendo registro manual.
          </p>
        </Card>
      </div>
    </div>
  );
}
