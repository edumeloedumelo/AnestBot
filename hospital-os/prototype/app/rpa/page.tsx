"use client";

import { useState } from "react";
import { Card, PageHeader, Chip, Alerta, PatientBanner } from "@/components/ui";
import { pacientes } from "@/lib/data";

const criteriosAldrete = [
  { nome: "Atividade motora", opcoes: ["Move 4 membros (2)", "Move 2 membros (1)", "Não move (0)"] },
  { nome: "Respiração", opcoes: ["Respira e tosse livremente (2)", "Dispneia / respiração limitada (1)", "Apneia (0)"] },
  { nome: "Circulação (PA vs pré)", opcoes: ["± 20% (2)", "± 20–50% (1)", "> ± 50% (0)"] },
  { nome: "Consciência", opcoes: ["Totalmente acordado (2)", "Desperta ao chamado (1)", "Não responde (0)"] },
  { nome: "Saturação de O₂", opcoes: ["> 92% em ar ambiente (2)", "Necessita O₂ (1)", "< 90% com O₂ (0)"] },
];

type Obs = { horario: string; pa: string; fc: string; spo2: string; dor: string };

const obsIniciais: Obs[] = [
  { horario: "10:05", pa: "128×82", fc: "78", spo2: "97%", dor: "2/10" },
  { horario: "10:20", pa: "122×80", fc: "74", spo2: "98%", dor: "2/10" },
];

export default function RpaPage() {
  const paciente = pacientes[4]; // Fernanda, tireoidectomia, em RPA
  const [pontos, setPontos] = useState<number[]>([2, 2, 2, 1, 2]);
  const [obs, setObs] = useState(obsIniciais);
  const [nova, setNova] = useState<Obs>({ horario: "10:35", pa: "", fc: "", spo2: "", dor: "" });

  const aldrete = pontos.reduce((a, b) => a + b, 0);
  const dorAtual = obs.length > 0 ? parseInt(obs[obs.length - 1].dor) : 10;

  const criteriosAlta = [
    { rotulo: "Aldrete ≥ 9", ok: aldrete >= 9 },
    { rotulo: "Dor ≤ 3/10", ok: dorAtual <= 3 },
    { rotulo: "Sem sangramento ativo", ok: true },
    { rotulo: "Náusea/vômito controlados", ok: true },
  ];
  const apto = criteriosAlta.every((c) => c.ok);
  const campo = "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm";

  return (
    <div>
      <PageHeader title="Recuperação pós-anestésica" subtitle="Tireoidectomia total · admissão na RPA às 10:00 · Dr. Teste Viana">
        <Chip className="border-violet-300 bg-violet-50 text-violet-800">Em RPA — 35 min de permanência</Chip>
      </PageHeader>
      <PatientBanner paciente={paciente} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Escala de Aldrete</h2>
            <span className="text-2xl font-bold text-slate-900">
              {aldrete}<span className="text-sm font-normal text-slate-400">/10</span>
            </span>
          </div>
          <div className="space-y-3">
            {criteriosAldrete.map((c, i) => (
              <div key={c.nome}>
                <div className="mb-1 text-sm font-medium text-slate-700">{c.nome}</div>
                <div className="flex flex-wrap gap-1.5">
                  {c.opcoes.map((o, j) => {
                    const valor = 2 - j;
                    const ativo = pontos[i] === valor;
                    return (
                      <button
                        key={o}
                        onClick={() => setPontos(pontos.map((p, k) => (k === i ? valor : p)))}
                        className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
                          ativo ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-600"
                        }`}
                      >
                        {o}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-800">Observações seriadas</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  {["Hora", "PA", "FC", "SpO₂", "Dor"].map((h) => (
                    <th key={h} className="py-1.5 pr-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {obs.map((o, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="py-1.5 pr-2 font-mono text-xs">{o.horario}</td>
                    <td className="py-1.5 pr-2">{o.pa}</td>
                    <td className="py-1.5 pr-2">{o.fc}</td>
                    <td className="py-1.5 pr-2">{o.spo2}</td>
                    <td className="py-1.5 pr-2">{o.dor}</td>
                  </tr>
                ))}
                <tr className="border-t border-slate-200">
                  <td className="py-1.5 pr-2 font-mono text-xs">{nova.horario}</td>
                  {(["pa", "fc", "spo2", "dor"] as const).map((k) => (
                    <td key={k} className="py-1.5 pr-2">
                      <input className={campo} value={nova[k]} onChange={(e) => setNova({ ...nova, [k]: e.target.value })} placeholder={k === "dor" ? "0/10" : ""} />
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
            <button
              className="mt-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 disabled:opacity-40"
              disabled={!nova.pa || !nova.fc}
              onClick={() => {
                setObs([...obs, nova]);
                setNova({ horario: "10:50", pa: "", fc: "", spo2: "", dor: "" });
              }}
            >
              Registrar observação
            </button>
          </Card>

          <Card className="p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-800">Critérios de alta da RPA</h2>
            <ul className="space-y-1.5 text-sm">
              {criteriosAlta.map((c) => (
                <li key={c.rotulo} className="flex items-center gap-2">
                  <span aria-hidden>{c.ok ? "✅" : "⬜"}</span>
                  <span className={c.ok ? "text-slate-600" : "font-medium text-slate-900"}>{c.rotulo}</span>
                  {!c.ok && <Chip className="border-amber-300 bg-amber-50 text-amber-800">não atingido</Chip>}
                </li>
              ))}
            </ul>
            {apto ? (
              <button className="mt-3 rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white">
                Dar alta da RPA (simulado)
              </button>
            ) : (
              <div className="mt-3 space-y-2">
                <Alerta nivel="atencao">Critérios não atingidos. Alta antecipada exige justificativa médica registrada.</Alerta>
                <button className="rounded-md border border-amber-400 px-4 py-2 text-sm font-medium text-amber-800">
                  Alta com justificativa médica…
                </button>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
