"use client";

import { useState } from "react";
import { Card, PageHeader, Chip, Alerta, PatientBanner } from "@/components/ui";
import { pacientes, salas } from "@/lib/data";

const etapas = ["Paciente", "Procedimento", "Equipe", "Recursos", "Revisão"] as const;

type Form = {
  pacienteId: string;
  procedimento: string;
  tuss: string;
  lateralidade: string;
  cirurgiao: string;
  anestesista: string;
  sala: string;
  duracao: string;
  opme: "nao_precisa" | "solicitado" | "confirmado" | "";
  sangue: "nao_precisa" | "reservado" | "";
  uti: "nao_precisa" | "reservada" | "";
  consentimento: boolean;
};

const inicial: Form = {
  pacienteId: "", procedimento: "", tuss: "", lateralidade: "", cirurgiao: "",
  anestesista: "", sala: "", duracao: "", opme: "", sangue: "", uti: "", consentimento: false,
};

export default function AgendamentoPage() {
  const [etapa, setEtapa] = useState(0);
  const [form, setForm] = useState<Form>(inicial);
  const [agendado, setAgendado] = useState(false);

  const paciente = pacientes.find((p) => p.id === form.pacienteId);

  // Itens críticos: sem eles o agendamento é bloqueado (configurável por instituição).
  const criticos: { rotulo: string; ok: boolean }[] = [
    { rotulo: "Paciente identificado", ok: !!form.pacienteId },
    { rotulo: "Procedimento com código TUSS", ok: !!form.procedimento && !!form.tuss },
    { rotulo: "Lateralidade definida", ok: !!form.lateralidade },
    { rotulo: "Cirurgião e anestesista definidos", ok: !!form.cirurgiao && !!form.anestesista },
    { rotulo: "Duração prevista informada", ok: !!form.duracao },
    { rotulo: "OPME: situação definida (não precisa / solicitado / confirmado)", ok: form.opme !== "" },
    { rotulo: "Reserva de sangue: situação definida", ok: form.sangue !== "" },
    { rotulo: "Reserva de UTI: situação definida", ok: form.uti !== "" },
    { rotulo: "Termo de consentimento registrado", ok: form.consentimento },
  ];
  const faltantes = criticos.filter((c) => !c.ok);

  const campo = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
  const rotulo = "mb-1 block text-sm font-medium text-slate-700";

  function set<K extends keyof Form>(k: K, v: Form[K]) {
    setForm({ ...form, [k]: v });
  }

  if (agendado && paciente) {
    return (
      <div>
        <PageHeader title="Agendamento cirúrgico" />
        <Alerta nivel="info">
          Cirurgia agendada (simulação): {form.procedimento} — {paciente.nome}, {form.sala || "sala a definir"},
          duração prevista {form.duracao} min. O caso entrou no mapa com status &quot;Solicitada&quot; e seguirá para autorização.
        </Alerta>
        <button className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white" onClick={() => { setForm(inicial); setEtapa(0); setAgendado(false); }}>
          Novo agendamento
        </button>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Agendamento cirúrgico" subtitle="Fluxo guiado. Itens críticos incompletos bloqueiam o agendamento." />
      {paciente && <PatientBanner paciente={paciente} />}

      <div className="mb-4 flex flex-wrap gap-1">
        {etapas.map((e, i) => (
          <button
            key={e}
            onClick={() => setEtapa(i)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              i === etapa ? "bg-slate-900 text-white" : "bg-white text-slate-600 border border-slate-300"
            }`}
          >
            {i + 1}. {e}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="p-4">
          {etapa === 0 && (
            <div className="space-y-3">
              <label className={rotulo}>Paciente</label>
              <select className={campo} value={form.pacienteId} onChange={(e) => set("pacienteId", e.target.value)}>
                <option value="">Selecionar paciente…</option>
                {pacientes.map((p) => (
                  <option key={p.id} value={p.id}>{p.nome} — pront. {p.prontuario}</option>
                ))}
              </select>
              <p className="text-xs text-slate-500">Na versão real: busca com deduplicação e criação de cadastro inline.</p>
            </div>
          )}

          {etapa === 1 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={rotulo}>Procedimento</label>
                <input className={campo} value={form.procedimento} onChange={(e) => set("procedimento", e.target.value)} placeholder="Ex.: Colecistectomia videolaparoscópica" />
              </div>
              <div>
                <label className={rotulo}>Código TUSS</label>
                <input className={campo} value={form.tuss} onChange={(e) => set("tuss", e.target.value)} placeholder="Ex.: 31005497" />
              </div>
              <div>
                <label className={rotulo}>Lateralidade</label>
                <select className={campo} value={form.lateralidade} onChange={(e) => set("lateralidade", e.target.value)}>
                  <option value="">Selecionar…</option>
                  {["Direita", "Esquerda", "Bilateral", "Não se aplica"].map((l) => <option key={l}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className={rotulo}>Duração prevista (min)</label>
                <input className={campo} type="number" value={form.duracao} onChange={(e) => set("duracao", e.target.value)} placeholder="90" />
              </div>
            </div>
          )}

          {etapa === 2 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={rotulo}>Cirurgião</label>
                <input className={campo} value={form.cirurgiao} onChange={(e) => set("cirurgiao", e.target.value)} placeholder="Nome do cirurgião" />
              </div>
              <div>
                <label className={rotulo}>Anestesiologista</label>
                <input className={campo} value={form.anestesista} onChange={(e) => set("anestesista", e.target.value)} placeholder="Nome do anestesiologista" />
              </div>
              <div>
                <label className={rotulo}>Sala (opcional nesta etapa)</label>
                <select className={campo} value={form.sala} onChange={(e) => set("sala", e.target.value)}>
                  <option value="">Definir no mapa…</option>
                  {salas.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
          )}

          {etapa === 3 && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className={rotulo}>OPME</label>
                <select className={campo} value={form.opme} onChange={(e) => set("opme", e.target.value as Form["opme"])}>
                  <option value="">Selecionar…</option>
                  <option value="nao_precisa">Não necessita</option>
                  <option value="solicitado">Solicitado ao fornecedor</option>
                  <option value="confirmado">Confirmado</option>
                </select>
              </div>
              <div>
                <label className={rotulo}>Reserva de sangue</label>
                <select className={campo} value={form.sangue} onChange={(e) => set("sangue", e.target.value as Form["sangue"])}>
                  <option value="">Selecionar…</option>
                  <option value="nao_precisa">Não necessita</option>
                  <option value="reservado">Reservado</option>
                </select>
              </div>
              <div>
                <label className={rotulo}>Reserva de UTI</label>
                <select className={campo} value={form.uti} onChange={(e) => set("uti", e.target.value as Form["uti"])}>
                  <option value="">Selecionar…</option>
                  <option value="nao_precisa">Não necessita</option>
                  <option value="reservada">Reservada</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-3">
                <input type="checkbox" checked={form.consentimento} onChange={(e) => set("consentimento", e.target.checked)} />
                Termo de consentimento livre e esclarecido registrado
              </label>
            </div>
          )}

          {etapa === 4 && (
            <div className="space-y-3 text-sm">
              <h2 className="font-semibold text-slate-800">Revisão</h2>
              <table className="w-full">
                <tbody>
                  {[
                    ["Paciente", paciente?.nome ?? "—"],
                    ["Procedimento", form.procedimento ? `${form.procedimento} (TUSS ${form.tuss || "—"})` : "—"],
                    ["Lateralidade", form.lateralidade || "—"],
                    ["Equipe", form.cirurgiao ? `${form.cirurgiao} / ${form.anestesista || "—"}` : "—"],
                    ["Sala / duração", `${form.sala || "a definir"} / ${form.duracao ? form.duracao + " min" : "—"}`],
                  ].map(([k, v]) => (
                    <tr key={k} className="border-t border-slate-100">
                      <td className="py-1.5 pr-4 font-medium text-slate-500">{k}</td>
                      <td className="py-1.5 text-slate-800">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {faltantes.length > 0 && (
                <Alerta nivel="atencao">
                  Agendamento bloqueado — {faltantes.length} item(ns) crítico(s) incompleto(s). Complete os itens listados ao lado.
                </Alerta>
              )}
            </div>
          )}

          <div className="mt-4 flex justify-between">
            <button
              className="rounded-md border border-slate-300 px-4 py-2 text-sm disabled:opacity-40"
              disabled={etapa === 0}
              onClick={() => setEtapa(etapa - 1)}
            >
              Voltar
            </button>
            {etapa < etapas.length - 1 ? (
              <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white" onClick={() => setEtapa(etapa + 1)}>
                Avançar
              </button>
            ) : (
              <button
                className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
                disabled={faltantes.length > 0}
                onClick={() => setAgendado(true)}
                title={faltantes.length > 0 ? "Itens críticos incompletos" : "Agendar"}
              >
                Agendar cirurgia
              </button>
            )}
          </div>
        </Card>

        <Card className="h-fit p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-800">Itens críticos</h2>
          <ul className="space-y-1.5 text-sm">
            {criticos.map((c) => (
              <li key={c.rotulo} className="flex items-start gap-2">
                <span aria-hidden>{c.ok ? "✅" : "⬜"}</span>
                <span className={c.ok ? "text-slate-500" : "text-slate-800"}>{c.rotulo}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            A lista de itens críticos é configurável por instituição. Sem todos completos, o botão &quot;Agendar&quot; permanece bloqueado.
          </p>
          {faltantes.length > 0 ? (
            <Chip className="mt-2 border-amber-300 bg-amber-50 text-amber-800">⚠ {faltantes.length} pendente(s)</Chip>
          ) : (
            <Chip className="mt-2 border-emerald-300 bg-emerald-50 text-emerald-800">✓ Completo — pronto para agendar</Chip>
          )}
        </Card>
      </div>
    </div>
  );
}
