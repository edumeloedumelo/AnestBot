"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, connectEvents } from "@/lib/api";

type MapCase = {
  id: string;
  status: string;
  start_at: string;
  end_at: string;
  room_id: string;
  room_name: string;
  patient_name: string;
  patient_mrn: string;
  procedure_name: string;
  surgeon: string;
  anesthesiologist: string;
  opme_status: string | null;
  blood_reserve: string | null;
  icu_reserve: string | null;
  consent_registered: boolean;
};

const INICIO_DIA = 7 * 60;
const FIM_DIA = 19 * 60;

const statusInfo: Record<string, { label: string; chip: string; bar: string }> = {
  requested: { label: "Solicitada", chip: "bg-slate-100 text-slate-700 border-slate-300", bar: "bg-slate-400" },
  authorized: { label: "Autorizada", chip: "bg-sky-50 text-sky-800 border-sky-300", bar: "bg-sky-500" },
  confirmed: { label: "Confirmada", chip: "bg-blue-50 text-blue-800 border-blue-300", bar: "bg-blue-600" },
  in_preparation: { label: "Em preparo", chip: "bg-indigo-50 text-indigo-800 border-indigo-300", bar: "bg-indigo-500" },
  in_room: { label: "Em sala", chip: "bg-emerald-50 text-emerald-800 border-emerald-300", bar: "bg-emerald-600" },
  in_pacu: { label: "Em RPA", chip: "bg-violet-50 text-violet-800 border-violet-300", bar: "bg-violet-500" },
  completed: { label: "Concluída", chip: "bg-slate-100 text-slate-500 border-slate-200", bar: "bg-slate-300" },
};

function minutesOf(iso: string): number {
  const date = new Date(iso);
  return date.getHours() * 60 + date.getMinutes();
}

function hora(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

function pendencias(c: MapCase): number {
  let count = 0;
  if (c.opme_status === null) count++;
  if (c.blood_reserve === null) count++;
  if (c.icu_reserve === null) count++;
  if (!c.consent_registered) count++;
  return count;
}

export default function MapaPage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [cases, setCases] = useState<MapCase[]>([]);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCases(await api<MapCase[]>(`/surgery-cases/map?date=${date}`));
      setError(null);
    } catch {
      setError("Falha ao carregar o mapa.");
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // Qualquer evento cirúrgico do tenant recarrega o mapa (payloads são
    // mínimos por design; o estado autoritativo vem sempre da API).
    return connectEvents(
      (event) => {
        if (event.topic.startsWith("surgery.")) void load();
      },
      (open) => setLive(open)
    );
  }, [load]);

  const rooms = useMemo(() => {
    const names = new Map<string, string>();
    for (const c of cases) names.set(c.room_id, c.room_name);
    return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [cases]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Mapa cirúrgico</h1>
          <p className="text-sm text-slate-500">Estado autoritativo da API; atualização em tempo real via eventos.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs ${live ? "text-emerald-700" : "text-slate-400"}`}>
            {live ? "● Ao vivo" : "○ Reconectando…"}
          </span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
            aria-label="Data do mapa"
          />
        </div>
      </div>

      {error && <p className="mb-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}

      {rooms.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Nenhum caso agendado para {date}.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex min-w-[840px] gap-2">
            <div className="w-12 shrink-0" style={{ paddingTop: 28 }}>
              {Array.from({ length: (FIM_DIA - INICIO_DIA) / 60 + 1 }, (_, i) => (
                <div key={i} className="text-right text-xs text-slate-400" style={{ height: 60 }}>
                  {hora(INICIO_DIA + i * 60)}
                </div>
              ))}
            </div>
            {rooms.map(([roomId, roomName]) => (
              <div key={roomId} className="min-w-0 flex-1">
                <div className="mb-1 text-center text-sm font-semibold text-slate-700">{roomName}</div>
                <div className="relative rounded-md border border-slate-200 bg-slate-50" style={{ height: FIM_DIA - INICIO_DIA }}>
                  {Array.from({ length: (FIM_DIA - INICIO_DIA) / 60 }, (_, i) => (
                    <div key={i} className="absolute w-full border-t border-slate-200/70" style={{ top: i * 60 }} />
                  ))}
                  {cases
                    .filter((c) => c.room_id === roomId)
                    .map((c) => {
                      const start = minutesOf(c.start_at);
                      const end = minutesOf(c.end_at);
                      const info = statusInfo[c.status] ?? statusInfo.requested;
                      const pend = pendencias(c);
                      return (
                        <div
                          key={c.id}
                          className={`absolute left-1 right-1 overflow-hidden rounded-md border bg-white p-1.5 text-xs shadow-sm ${
                            pend > 0 ? "border-amber-400" : "border-slate-300"
                          }`}
                          style={{ top: start - INICIO_DIA, height: Math.max(40, end - start - 2) }}
                          title={`${c.procedure_name} — ${c.patient_name}`}
                        >
                          <div className={`absolute inset-y-0 left-0 w-1 ${info.bar}`} aria-hidden />
                          <div className="pl-1.5">
                            <div className="truncate font-semibold text-slate-800">{c.procedure_name}</div>
                            <div className="truncate text-slate-500">
                              {hora(start)}–{hora(end)} · {c.patient_name.split(" (")[0]}
                            </div>
                            {end - start >= 75 ? (
                              <div className="mt-0.5 flex flex-wrap gap-1">
                                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 font-medium ${info.chip}`}>{info.label}</span>
                                {pend > 0 && (
                                  <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-800">
                                    ⚠ {pend} pendência(s)
                                  </span>
                                )}
                              </div>
                            ) : (
                              <div className="truncate text-[11px] text-slate-500">
                                {info.label}
                                {pend > 0 && <span className="text-amber-700"> · ⚠ {pend}</span>}
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
        </div>
      )}
    </div>
  );
}
