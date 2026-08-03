"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

type Patient = {
  id: string;
  mrn: string;
  fullName: string;
  birthDate: string;
  sex: string;
  cpf: string | null;
  active: boolean;
};

type Candidate = { id: string; mrn: string; reasons: string[] };

const reasonLabel: Record<string, string> = {
  same_cpf: "mesmo CPF",
  same_cns: "mesmo CNS",
  same_name: "mesmo nome",
  similar_name_same_birth_date: "nome semelhante + mesma data de nascimento",
};

export default function PacientesPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Patient[]>([]);
  const [criando, setCriando] = useState(false);
  const [form, setForm] = useState({ fullName: "", birthDate: "", sex: "U", cpf: "" });
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [justification, setJustification] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "erro"; text: string } | null>(null);

  const campo = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (query.trim()) {
        void api<Patient[]>(`/patients?query=${encodeURIComponent(query)}`).then(setResults).catch(() => setResults([]));
      } else {
        setResults([]);
      }
    }, 250);
    return () => clearTimeout(timeout);
  }, [query]);

  async function criar(withJustification: boolean) {
    setMessage(null);
    try {
      const created = await api<Patient>("/patients", {
        method: "POST",
        body: {
          fullName: form.fullName,
          birthDate: form.birthDate,
          sex: form.sex,
          ...(form.cpf ? { cpf: form.cpf } : {}),
          ...(withJustification && justification ? { duplicateOverrideJustification: justification } : {}),
        },
      });
      setMessage({ kind: "ok", text: `Paciente criado — prontuário ${created.mrn}.` });
      setCandidates(null);
      setJustification("");
      setForm({ fullName: "", birthDate: "", sex: "U", cpf: "" });
      setCriando(false);
      setQuery(created.mrn);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { candidates?: Candidate[] };
        setCandidates(body.candidates ?? []);
      } else if (err instanceof ApiError && err.status === 400) {
        const body = err.body as { message?: string | string[] };
        setMessage({ kind: "erro", text: Array.isArray(body.message) ? body.message.join("; ") : body.message ?? "Dados inválidos." });
      } else if (err instanceof ApiError && err.status === 403) {
        setMessage({ kind: "erro", text: "Seu papel não permite criar pacientes (exige recepção ou admin)." });
      } else {
        setMessage({ kind: "erro", text: "Falha ao criar paciente." });
      }
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Pacientes</h1>
          <p className="text-sm text-slate-500">Buscar antes de criar — a deduplicação é parte do fluxo.</p>
        </div>
        <button onClick={() => { setCriando(!criando); setCandidates(null); setMessage(null); }} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
          {criando ? "Voltar à busca" : "Novo paciente"}
        </button>
      </div>

      {message && (
        <p className={`mb-3 rounded-md border px-3 py-2 text-sm ${message.kind === "ok" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-rose-300 bg-rose-50 text-rose-800"}`}>
          {message.text}
        </p>
      )}

      {!criando ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <input className={campo} placeholder="Buscar por nome, prontuário ou CPF…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar paciente" />
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                {["Nome", "Nascimento", "Prontuário", "CPF"].map((h) => (
                  <th key={h} className="py-1.5 pr-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="py-2 pr-3 font-medium text-slate-800">{p.fullName}</td>
                  <td className="py-2 pr-3">{p.birthDate}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{p.mrn}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{p.cpf ?? "—"}</td>
                </tr>
              ))}
              {query.trim() && results.length === 0 && (
                <tr><td colSpan={4} className="py-3 text-slate-400">Nenhum paciente encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Novo cadastro</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">Nome completo</label>
                <input className={campo} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Nascimento</label>
                <input className={campo} type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Sexo</label>
                <select className={campo} value={form.sex} onChange={(e) => setForm({ ...form, sex: e.target.value })}>
                  <option value="F">Feminino</option>
                  <option value="M">Masculino</option>
                  <option value="O">Outro</option>
                  <option value="U">Não informado</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">CPF (opcional)</label>
                <input className={campo} value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value })} />
              </div>
            </div>
            <button
              className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              disabled={!form.fullName || !form.birthDate}
              onClick={() => criar(false)}
            >
              Criar cadastro
            </button>
          </div>

          <div className="h-fit rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-slate-800">Verificação de duplicidade</h2>
            {candidates === null ? (
              <p className="text-sm text-slate-400">A verificação roda no servidor ao criar. Duplicidades bloqueiam a criação.</p>
            ) : (
              <div className="space-y-2">
                <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  ⚠ {candidates.length} cadastro(s) semelhante(s). Use um existente ou justifique a criação.
                </p>
                {candidates.map((c) => (
                  <div key={c.id} className="rounded-md border border-slate-300 p-2.5 text-sm">
                    <div className="font-mono text-xs text-slate-500">Prontuário {c.mrn}</div>
                    <div className="text-xs text-slate-600">{c.reasons.map((r) => reasonLabel[r] ?? r).join("; ")}</div>
                  </div>
                ))}
                <textarea
                  className={campo}
                  rows={2}
                  placeholder="Justificativa para criar mesmo assim (mín. 10 caracteres)…"
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                />
                <button
                  className="rounded-md border border-amber-500 px-3 py-1.5 text-sm font-medium text-amber-800 disabled:opacity-40"
                  disabled={justification.trim().length < 10}
                  onClick={() => criar(true)}
                >
                  Criar com justificativa (auditado)
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
