"use client";

import { Card, PageHeader, InfoDicionario } from "@/components/ui";
import { indicadores, causasCancelamento } from "@/lib/data";

export default function RelatoriosPage() {
  const maxCausa = Math.max(...causasCancelamento.map((c) => c.qtd));

  return (
    <div>
      <PageHeader
        title="Relatórios do centro cirúrgico"
        subtitle="Mês corrente (dados sintéticos). Todo indicador tem definição, fórmula, fonte e limitações — clique no ⓘ."
      >
        <select className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm" aria-label="Período">
          <option>Mês corrente</option>
          <option>Mês anterior</option>
          <option>Trimestre</option>
        </select>
        <button className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm">Exportar (simulado)</button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {indicadores.map((ind) => (
          <Card key={ind.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-medium text-slate-500">{ind.nome}</div>
              <InfoDicionario
                definicao={ind.definicao}
                formula={ind.formula}
                fonte={ind.fonte}
                periodo={ind.periodo}
                limitacoes={ind.limitacoes}
              />
            </div>
            <div className="mt-1 text-3xl font-bold text-slate-900">{ind.valor}</div>
            {ind.variacao && <div className="mt-0.5 text-xs text-slate-500">{ind.variacao}</div>}
          </Card>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-800">Cancelamentos por causa</h2>
          <p className="mb-3 text-xs text-slate-500">8 cancelamentos no mês. Causa registrada é obrigatória ao cancelar.</p>
          <ul className="space-y-2">
            {causasCancelamento.map((c) => (
              <li key={c.causa}>
                <div className="mb-0.5 flex items-baseline justify-between text-sm">
                  <span className="text-slate-700">{c.causa}</span>
                  <span className="font-medium text-slate-900">{c.qtd}</span>
                </div>
                <div className="h-3 w-full rounded-r bg-slate-100">
                  <div className="h-3 rounded-r bg-blue-600" style={{ width: `${(c.qtd / maxCausa) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-800">Produção por anestesiologista</h2>
          <p className="mb-3 text-xs text-slate-500">Casos concluídos no mês (dados sintéticos).</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                {["Profissional", "Casos", "Horas de sala", "Tempo médio RPA"].map((h) => (
                  <th key={h} className="py-1.5 pr-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ["Dr. Teste Melo", "42", "96 h", "58 min"],
                ["Dra. Teste Rocha", "38", "88 h", "64 min"],
                ["Dr. Teste Viana", "35", "79 h", "61 min"],
                ["Dra. Teste Lopes", "31", "64 h", "66 min"],
              ].map((linha) => (
                <tr key={linha[0]} className="border-t border-slate-100">
                  {linha.map((v, i) => (
                    <td key={i} className={`py-2 pr-3 ${i === 0 ? "font-medium text-slate-800" : "text-slate-600"}`}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
