"use client";

import { useMemo, useState } from "react";
import { Card, PageHeader, Chip, Alerta } from "@/components/ui";
import { cirurgias as base, salas, statusInfo, pacienteDe, hora, type Cirurgia } from "@/lib/data";

const INICIO_DIA = 7 * 60;
const FIM_DIA = 19 * 60;
const PX_POR_MIN = 1;

function sobrepoe(aIni: number, aFim: number, bIni: number, bFim: number) {
  return aIni < bFim && bIni < aFim;
}

export default function MapaPage() {
  const [casos, setCasos] = useState<Cirurgia[]>(base);
  const [visao, setVisao] = useState<"dia" | "semana">("dia");
  const [filtroCirurgiao, setFiltroCirurgiao] = useState("todos");
  const [conflito, setConflito] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);

  const cirurgioes = useMemo(() => Array.from(new Set(base.map((c) => c.cirurgiao))).sort(), []);
  const visiveis = casos.filter((c) => filtroCirurgiao === "todos" || c.cirurgiao === filtroCirurgiao);

  function mover(id: string, novaSala: string, novoInicio: number) {
    const caso = casos.find((c) => c.id === id);
    if (!caso) return;
    const fim = novoInicio + caso.duracao;

    if (novoInicio < INICIO_DIA || fim > FIM_DIA) {
      setConflito(`Fora do horário de funcionamento do centro cirúrgico (07:00–19:00).`);
      return;
    }
    const ocupacaoSala = casos.find((c) => c.id !== id && c.sala === novaSala && sobrepoe(novoInicio, fim, c.inicio, c.inicio + c.duracao));
    if (ocupacaoSala) {
      setConflito(`${novaSala} já ocupada nesse horário por "${ocupacaoSala.procedimento}" (${hora(ocupacaoSala.inicio)}–${hora(ocupacaoSala.inicio + ocupacaoSala.duracao)}).`);
      return;
    }
    const equipeOcupada = casos.find(
      (c) =>
        c.id !== id &&
        (c.cirurgiao === caso.cirurgiao || c.anestesista === caso.anestesista) &&
        sobrepoe(novoInicio, fim, c.inicio, c.inicio + c.duracao)
    );
    if (equipeOcupada) {
      const quem = equipeOcupada.cirurgiao === caso.cirurgiao ? caso.cirurgiao : caso.anestesista;
      setConflito(`Conflito de equipe: ${quem} estará em ${equipeOcupada.sala} nesse horário ("${equipeOcupada.procedimento}").`);
      return;
    }
    setConflito(null);
    setCasos(casos.map((c) => (c.id === id ? { ...c, sala: novaSala, inicio: novoInicio } : c)));
  }

  return (
    <div>
      <PageHeader title="Mapa cirúrgico" subtitle="Arraste um caso para reagendar. Conflitos de sala e equipe são bloqueados.">
        <span className="text-xs text-emerald-700">● Sincronizado agora (simulado)</span>
        <div className="flex overflow-hidden rounded-md border border-slate-300 text-sm">
          {(["dia", "semana"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setVisao(v)}
              className={`px-3 py-1.5 ${visao === v ? "bg-slate-900 text-white" : "bg-white text-slate-600"}`}
            >
              {v === "dia" ? "Dia" : "Semana"}
            </button>
          ))}
        </div>
        <select
          value={filtroCirurgiao}
          onChange={(e) => setFiltroCirurgiao(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
          aria-label="Filtrar por cirurgião"
        >
          <option value="todos">Todos os cirurgiões</option>
          {cirurgioes.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </PageHeader>

      {conflito && (
        <div className="mb-3">
          <Alerta nivel="critico">{conflito} A movimentação foi rejeitada.</Alerta>
        </div>
      )}

      {visao === "semana" ? (
        <Card className="p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-2 font-medium">Sala</th>
                {["Seg", "Ter", "Qua", "Qui", "Sex"].map((d) => (
                  <th key={d} className="py-2 font-medium">{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {salas.map((s, i) => (
                <tr key={s} className="border-t border-slate-100">
                  <td className="py-2 font-medium text-slate-700">{s}</td>
                  {[0, 1, 2, 3, 4].map((d) => {
                    const qtd = d === 2 ? visiveis.filter((c) => c.sala === s).length : ((i * 3 + d * 2) % 4) + 1;
                    const ocup = Math.min(95, qtd * 22);
                    return (
                      <td key={d} className="py-2 pr-3">
                        <div className="text-slate-700">{qtd} casos</div>
                        <div className="mt-1 h-1.5 w-full rounded bg-slate-100">
                          <div className="h-1.5 rounded bg-blue-600" style={{ width: `${ocup}%` }} />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-slate-500">Visão semanal simplificada (quarta = dia detalhado). Barra = ocupação estimada da sala.</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-4">
          <div className="flex min-w-[840px] gap-2">
            <div className="w-12 shrink-0" style={{ paddingTop: 28 }}>
              {Array.from({ length: (FIM_DIA - INICIO_DIA) / 60 + 1 }, (_, i) => (
                <div key={i} className="text-right text-xs text-slate-400" style={{ height: 60 * PX_POR_MIN }}>
                  {hora(INICIO_DIA + i * 60)}
                </div>
              ))}
            </div>
            {salas.map((sala) => (
              <div key={sala} className="min-w-0 flex-1">
                <div className="mb-1 text-center text-sm font-semibold text-slate-700">{sala}</div>
                <div
                  className="relative rounded-md border border-slate-200 bg-slate-50"
                  style={{ height: (FIM_DIA - INICIO_DIA) * PX_POR_MIN }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData("text/plain");
                    const rect = e.currentTarget.getBoundingClientRect();
                    const min = INICIO_DIA + Math.round((e.clientY - rect.top) / PX_POR_MIN / 15) * 15;
                    mover(id, sala, min);
                    setArrastando(null);
                  }}
                >
                  {Array.from({ length: (FIM_DIA - INICIO_DIA) / 60 }, (_, i) => (
                    <div key={i} className="absolute w-full border-t border-slate-200/70" style={{ top: i * 60 * PX_POR_MIN }} />
                  ))}
                  {visiveis
                    .filter((c) => c.sala === sala)
                    .map((c) => {
                      const p = pacienteDe(c);
                      const info = statusInfo[c.status];
                      return (
                        <div
                          key={c.id}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", c.id);
                            setArrastando(c.id);
                          }}
                          onDragEnd={() => setArrastando(null)}
                          className={`absolute left-1 right-1 cursor-grab overflow-hidden rounded-md border bg-white p-1.5 text-xs shadow-sm ${
                            arrastando === c.id ? "opacity-50" : ""
                          } ${c.pendencias.length > 0 ? "border-amber-400" : "border-slate-300"}`}
                          style={{ top: (c.inicio - INICIO_DIA) * PX_POR_MIN, height: Math.max(40, c.duracao * PX_POR_MIN - 2) }}
                          title={`${c.procedimento} — ${p.nome}`}
                        >
                          <div className={`absolute inset-y-0 left-0 w-1 ${info.bar}`} aria-hidden />
                          <div className="pl-1.5">
                            <div className="truncate font-semibold text-slate-800">{c.procedimento}</div>
                            <div className="truncate text-slate-500">
                              {hora(c.inicio)}–{hora(c.inicio + c.duracao)} · {p.nome.split(" ")[0]} {p.nome.split(" ")[1]}
                            </div>
                            {c.duracao >= 75 ? (
                              <div className="mt-0.5 flex flex-wrap gap-1">
                                <Chip className={info.chip}>{info.label}</Chip>
                                {c.pendencias.length > 0 && (
                                  <Chip className="border-amber-300 bg-amber-50 text-amber-800">⚠ {c.pendencias.length} pendência(s)</Chip>
                                )}
                              </div>
                            ) : (
                              <div className="truncate text-[11px] text-slate-500">
                                {info.label}
                                {c.pendencias.length > 0 && <span className="text-amber-700"> · ⚠ {c.pendencias.length} pendência(s)</span>}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
            Legenda:
            {Object.entries(statusInfo)
              .filter(([k]) => ["confirmada", "em_sala", "em_rpa", "autorizada", "solicitada"].includes(k))
              .map(([k, v]) => (
                <Chip key={k} className={v.chip}>{v.label}</Chip>
              ))}
            <Chip className="border-amber-300 bg-amber-50 text-amber-800">⚠ com pendência</Chip>
          </div>
        </Card>
      )}
    </div>
  );
}
