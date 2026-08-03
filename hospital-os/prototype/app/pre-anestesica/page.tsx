"use client";

import { useState } from "react";
import { Card, PageHeader, Chip, Alerta, PatientBanner } from "@/components/ui";
import { pacientes } from "@/lib/data";

type Sugestao = {
  id: string;
  campo: string;
  valor: string;
  fonte: string;
  incerteza: "baixa" | "média" | "alta";
  estado: "pendente" | "aceita" | "rejeitada";
};

const sugestoesIniciais: Sugestao[] = [
  { id: "s1", campo: "Hemoglobina", valor: "10,2 g/dL (abaixo do limiar de 11 para este porte)", fonte: "Hemograma 21/07/2026, pág. 1 do PDF anexado", incerteza: "baixa", estado: "pendente" },
  { id: "s2", campo: "Creatinina", valor: "1,1 mg/dL (normal)", fonte: "Bioquímica 21/07/2026, pág. 2 do PDF anexado", incerteza: "baixa", estado: "pendente" },
  { id: "s3", campo: "Uso de anticoagulante", valor: "Possível uso de rivaroxabana citado em receita anexada — confirmar com o paciente", fonte: "Foto de receita, anexo 3 (legibilidade parcial)", incerteza: "alta", estado: "pendente" },
  { id: "s4", campo: "ECG", valor: "Ausente nos anexos — obrigatório para ASA III neste protocolo", fonte: "Verificação de completude dos anexos", incerteza: "baixa", estado: "pendente" },
];

const secoes = ["Antecedentes", "Medicamentos", "Alergias", "Via aérea", "Exames", "Plano"] as const;

export default function PreAnestesicaPage() {
  const paciente = pacientes[3]; // Carlos, ASA III
  const [secao, setSecao] = useState<(typeof secoes)[number]>("Antecedentes");
  const [sugestoes, setSugestoes] = useState(sugestoesIniciais);
  const [asa, setAsa] = useState("III");
  const [mallampati, setMallampati] = useState("II");
  const [decisao, setDecisao] = useState<"" | "liberado" | "pendencias" | "adiado">("");

  function decidir(id: string, estado: "aceita" | "rejeitada") {
    setSugestoes(sugestoes.map((s) => (s.id === id ? { ...s, estado } : s)));
  }

  const campo = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
  const rotulo = "mb-1 block text-sm font-medium text-slate-700";
  const pendentes = sugestoes.filter((s) => s.estado === "pendente").length;

  return (
    <div>
      <PageHeader title="Avaliação pré-anestésica" subtitle="Procedimento: RTU de próstata · Dr. Teste Cunha · agendada para 12:00" />
      <PatientBanner paciente={paciente} />

      <div className="grid gap-4 lg:grid-cols-[180px_1fr_360px]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Seções da avaliação">
          {secoes.map((s) => (
            <button
              key={s}
              onClick={() => setSecao(s)}
              className={`whitespace-nowrap rounded-md px-3 py-2 text-left text-sm font-medium ${
                secao === s ? "bg-slate-900 text-white" : "bg-white text-slate-600 border border-slate-200"
              }`}
            >
              {s}
            </button>
          ))}
        </nav>

        <Card className="p-4">
          {secao === "Antecedentes" && (
            <div className="space-y-3">
              <div>
                <label className={rotulo}>Comorbidades</label>
                <div className="flex flex-wrap gap-2">
                  {["HAS", "DM2", "DPOC", "Coronariopatia", "Obesidade", "IRC"].map((c) => (
                    <label key={c} className="flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm">
                      <input type="checkbox" defaultChecked={["HAS", "DM2"].includes(c)} /> {c}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className={rotulo}>Cirurgias e anestesias prévias / intercorrências</label>
                <textarea className={campo} rows={3} defaultValue="Herniorrafia (2019), raquianestesia sem intercorrências." />
              </div>
              <div className="max-w-40">
                <label className={rotulo}>Capacidade funcional</label>
                <select className={campo} defaultValue="> 4 METs">
                  {["< 4 METs", "> 4 METs", "Não avaliável"].map((o) => <option key={o}>{o}</option>)}
                </select>
              </div>
            </div>
          )}

          {secao === "Medicamentos" && (
            <div className="space-y-3">
              <label className={rotulo}>Medicamentos em uso</label>
              <textarea className={campo} rows={3} defaultValue="Losartana 50 mg 12/12h; Metformina 850 mg 12/12h." />
              <Alerta nivel="atencao">
                Sugestão de IA pendente sobre possível anticoagulante — verifique o painel de triagem ao lado antes de concluir esta seção.
              </Alerta>
            </div>
          )}

          {secao === "Alergias" && (
            <div className="space-y-2">
              <label className={rotulo}>Alergias</label>
              <p className="text-sm text-slate-600">Nenhuma alergia registrada no cadastro. Confirmar verbalmente com o paciente.</p>
              <input className={campo} placeholder="Adicionar alergia…" />
            </div>
          )}

          {secao === "Via aérea" && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className={rotulo}>Mallampati</label>
                <select className={campo} value={mallampati} onChange={(e) => setMallampati(e.target.value)}>
                  {["I", "II", "III", "IV"].map((o) => <option key={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className={rotulo}>Abertura bucal</label>
                <select className={campo} defaultValue="> 3 cm">{["> 3 cm", "< 3 cm"].map((o) => <option key={o}>{o}</option>)}</select>
              </div>
              <div>
                <label className={rotulo}>Preditores de via aérea difícil</label>
                <select className={campo} defaultValue="Ausentes">{["Ausentes", "Presentes"].map((o) => <option key={o}>{o}</option>)}</select>
              </div>
            </div>
          )}

          {secao === "Exames" && (
            <div className="space-y-2 text-sm">
              <p className="text-slate-600">
                Exames anexados: Hemograma (PDF), Bioquímica (PDF), Receita (foto). A triagem assistida por IA está no painel ao lado —
                <strong> nenhum valor entra nesta avaliação sem sua confirmação explícita.</strong>
              </p>
              <ul className="space-y-1">
                {sugestoes.filter((s) => s.estado === "aceita").map((s) => (
                  <li key={s.id} className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
                    <span className="font-medium">{s.campo}:</span> {s.valor}{" "}
                    <Chip className="ml-1 border-emerald-300 bg-white text-emerald-800">via sugestão de IA aceita por você</Chip>
                  </li>
                ))}
                {sugestoes.filter((s) => s.estado === "aceita").length === 0 && (
                  <li className="text-slate-400">Nenhum dado incorporado ainda.</li>
                )}
              </ul>
            </div>
          )}

          {secao === "Plano" && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className={rotulo}>ASA</label>
                  <select className={campo} value={asa} onChange={(e) => setAsa(e.target.value)}>
                    {["I", "II", "III", "IV"].map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className={rotulo}>Técnica planejada</label>
                  <select className={campo} defaultValue="Raquianestesia">
                    {["Geral balanceada", "Raquianestesia", "Peridural", "Bloqueio periférico", "Sedação"].map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={rotulo}>Decisão</label>
                <div className="flex flex-wrap gap-2">
                  {([
                    ["liberado", "Liberado para cirurgia"],
                    ["pendencias", "Liberado com pendências"],
                    ["adiado", "Adiar / contraindicar"],
                  ] as const).map(([v, r]) => (
                    <label key={v} className="flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm">
                      <input type="radio" name="decisao" checked={decisao === v} onChange={() => setDecisao(v)} /> {r}
                    </label>
                  ))}
                </div>
              </div>
              {decisao === "adiado" && (
                <div>
                  <label className={rotulo}>Motivo do adiamento (obrigatório)</label>
                  <textarea className={campo} rows={2} placeholder="Descreva o motivo clínico…" />
                </div>
              )}
              {decisao === "liberado" && pendentes > 0 && (
                <Alerta nivel="atencao">
                  Existem {pendentes} sugestões de IA não revisadas. Revise-as antes de assinar a liberação.
                </Alerta>
              )}
              <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40" disabled={!decisao}>
                Assinar avaliação (simulado)
              </button>
            </div>
          )}
        </Card>

        <Card className="h-fit p-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-800">Triagem de exames — sugestões de IA</h2>
          <p className="mb-3 text-xs text-slate-500">
            Sugestões geradas a partir dos anexos. Cada item cita a origem e exige sua decisão. Nada é preenchido automaticamente.
          </p>
          <ul className="space-y-2">
            {sugestoes.map((s) => (
              <li key={s.id} className={`rounded-md border p-2.5 text-sm ${s.estado === "rejeitada" ? "border-slate-200 bg-slate-50 opacity-60" : "border-slate-300"}`}>
                <div className="font-medium text-slate-800">{s.campo}</div>
                <div className="text-slate-600">{s.valor}</div>
                <div className="mt-1 text-xs text-slate-500">Fonte: {s.fonte}</div>
                <div className="mt-1.5 flex items-center gap-2">
                  <Chip
                    className={
                      s.incerteza === "alta"
                        ? "border-amber-300 bg-amber-50 text-amber-800"
                        : "border-slate-300 bg-slate-50 text-slate-600"
                    }
                  >
                    incerteza {s.incerteza}
                  </Chip>
                  {s.estado === "pendente" ? (
                    <>
                      <button onClick={() => decidir(s.id, "aceita")} className="rounded border border-emerald-600 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50">
                        Aceitar
                      </button>
                      <button onClick={() => decidir(s.id, "rejeitada")} className="rounded border border-slate-400 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
                        Rejeitar
                      </button>
                    </>
                  ) : (
                    <Chip className={s.estado === "aceita" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-slate-100 text-slate-500"}>
                      {s.estado === "aceita" ? "✓ aceita" : "✗ rejeitada"}
                    </Chip>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
