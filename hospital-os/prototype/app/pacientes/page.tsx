"use client";

import { useMemo, useState } from "react";
import { Card, PageHeader, Chip, Alerta, PatientBanner } from "@/components/ui";
import { pacientes } from "@/lib/data";

function normaliza(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\bde\b|\bda\b|\bdo\b/g, "").replace(/\s+/g, " ").trim();
}

export default function PacientesPage() {
  const [busca, setBusca] = useState("");
  const [criando, setCriando] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoNasc, setNovoNasc] = useState("");
  const [selecionado, setSelecionado] = useState<string | null>(null);

  const resultados = useMemo(() => {
    if (!busca.trim()) return pacientes;
    const b = normaliza(busca);
    return pacientes.filter((p) => normaliza(p.nome).includes(b) || p.prontuario.includes(busca.trim()));
  }, [busca]);

  const possiveisDuplicatas = useMemo(() => {
    if (!novoNome.trim()) return [];
    const n = normaliza(novoNome);
    return pacientes.filter((p) => {
      const semelhante = normaliza(p.nome).includes(n) || n.includes(normaliza(p.nome).split(" ").slice(0, 2).join(" "));
      const mesmaData = novoNasc && p.nascimento === novoNasc;
      return semelhante || mesmaData;
    });
  }, [novoNome, novoNasc]);

  const pacienteSel = pacientes.find((p) => p.id === selecionado);
  const campo = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

  return (
    <div>
      <PageHeader title="Pacientes" subtitle="Buscar antes de criar: a deduplicação é parte do fluxo, não um aviso posterior.">
        <button onClick={() => setCriando(!criando)} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
          {criando ? "Voltar à busca" : "Novo paciente"}
        </button>
      </PageHeader>

      {pacienteSel && <PatientBanner paciente={pacienteSel} />}

      {!criando ? (
        <Card className="p-4">
          <input
            className={campo}
            placeholder="Buscar por nome ou prontuário…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            aria-label="Buscar paciente"
          />
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                {["Nome", "Nascimento", "Prontuário", "Convênio", "Alergias", ""].map((h) => (
                  <th key={h} className="py-1.5 pr-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resultados.map((p) => (
                <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="py-2 pr-3 font-medium text-slate-800">{p.nome}</td>
                  <td className="py-2 pr-3">{p.nascimento}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{p.prontuario}</td>
                  <td className="py-2 pr-3">{p.convenio}</td>
                  <td className="py-2 pr-3">
                    {p.alergias.length > 0 ? (
                      <Chip className="border-rose-300 bg-rose-50 text-rose-800">⚠ {p.alergias.join(", ")}</Chip>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="py-2">
                    <button onClick={() => setSelecionado(p.id)} className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600">
                      Selecionar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Alerta nivel="info">
            Os cadastros &quot;Maria Aparecida Souza&quot; (pront. 000124) e &quot;Maria Aparecida de Souza&quot; (pront. 000891) têm a mesma data de
            nascimento — candidatos a mesclagem auditada. Na versão real, um fluxo de mesclagem preservaria o histórico das duas origens.
          </Alerta>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Novo cadastro</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">Nome completo</label>
                <input className={campo} value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Ex.: Maria Aparecida Souza" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Data de nascimento</label>
                <input className={campo} value={novoNasc} onChange={(e) => setNovoNasc(e.target.value)} placeholder="dd/mm/aaaa" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">CPF ou CNS</label>
                <input className={campo} placeholder="Documento de identificação" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Convênio</label>
                <input className={campo} placeholder="Convênio / Particular" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Telefone</label>
                <input className={campo} placeholder="(00) 00000-0000" />
              </div>
            </div>
            <button
              className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              disabled={!novoNome || possiveisDuplicatas.length > 0}
              title={possiveisDuplicatas.length > 0 ? "Resolva as possíveis duplicidades antes de criar" : ""}
            >
              Criar cadastro (simulado)
            </button>
            {possiveisDuplicatas.length > 0 && (
              <p className="mt-2 text-xs text-slate-500">
                O botão fica bloqueado enquanto houver possível duplicidade não resolvida (usar existente ou justificar novo cadastro).
              </p>
            )}
          </Card>

          <Card className="h-fit p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-800">Verificação de duplicidade</h2>
            {novoNome.trim() === "" ? (
              <p className="text-sm text-slate-400">Digite o nome para verificar duplicidades em tempo real.</p>
            ) : possiveisDuplicatas.length === 0 ? (
              <Chip className="border-emerald-300 bg-emerald-50 text-emerald-800">✓ Nenhum cadastro semelhante encontrado</Chip>
            ) : (
              <div className="space-y-2">
                <Alerta nivel="atencao">{possiveisDuplicatas.length} cadastro(s) semelhante(s) encontrado(s):</Alerta>
                {possiveisDuplicatas.map((p) => (
                  <div key={p.id} className="rounded-md border border-slate-300 p-2.5 text-sm">
                    <div className="font-medium text-slate-800">{p.nome}</div>
                    <div className="text-xs text-slate-500">Nasc. {p.nascimento} · Pront. {p.prontuario} · {p.convenio}</div>
                    <button className="mt-1.5 rounded border border-slate-400 px-2 py-1 text-xs font-medium text-slate-700">
                      Usar este cadastro
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
