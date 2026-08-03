"use client";

import Link from "next/link";
import { Card, PageHeader, Chip, Alerta } from "@/components/ui";
import { cirurgias, salas, statusInfo, pacienteDe, hora } from "@/lib/data";

const AGORA = 9 * 60 + 20;

export default function DashboardPage() {
  const emAndamento = cirurgias.filter((c) => c.status === "em_sala").length;
  const emRpa = cirurgias.filter((c) => c.status === "em_rpa").length;
  const pendencias = cirurgias.flatMap((c) => c.pendencias.map((p) => ({ caso: c, texto: p })));

  return (
    <div>
      <PageHeader title="Dashboard do dia" subtitle={`Quarta-feira · ${hora(AGORA)} (simulado) · Centro Cirúrgico — Unidade Teste`}>
        <Link href="/mapa" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
          Abrir mapa cirúrgico
        </Link>
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { rotulo: "Cirurgias hoje", valor: String(cirurgias.filter((c) => c.status !== "cancelada").length) },
          { rotulo: "Em sala agora", valor: String(emAndamento) },
          { rotulo: "Em RPA", valor: String(emRpa) },
          { rotulo: "Pendências abertas", valor: String(pendencias.length) },
        ].map((s) => (
          <Card key={s.rotulo} className="p-4">
            <div className="text-2xl font-bold text-slate-900">{s.valor}</div>
            <div className="text-sm text-slate-500">{s.rotulo}</div>
          </Card>
        ))}
      </div>

      <div className="mb-4 space-y-2">
        <Alerta nivel="critico">
          Sala 2, caso das 12:00 (RTU de próstata): avaliação pré-anestésica ainda pendente a menos de 3 h do início.{" "}
          <Link href="/pre-anestesica" className="underline">Abrir avaliação</Link>
        </Alerta>
        <Alerta nivel="atencao">OPME da herniorrafia das 11:00 (Sala 3) sem confirmação do fornecedor.</Alerta>
        <Alerta nivel="info">Mapa de amanhã publicado com 9 casos. Nenhum conflito detectado.</Alerta>
      </div>

      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
        {salas.map((sala) => {
          const casos = cirurgias.filter((c) => c.sala === sala && c.status !== "cancelada").sort((a, b) => a.inicio - b.inicio);
          const atual = casos.find((c) => c.inicio <= AGORA && AGORA < c.inicio + c.duracao);
          const proximo = casos.find((c) => c.inicio > AGORA);
          return (
            <Card key={sala} className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-semibold text-slate-800">{sala}</h2>
                {atual ? (
                  <Chip className={statusInfo[atual.status].chip}>{statusInfo[atual.status].label}</Chip>
                ) : (
                  <Chip className="border-slate-300 bg-slate-50 text-slate-500">Livre agora</Chip>
                )}
              </div>
              {atual && (
                <div className="mb-2 rounded-md border border-slate-200 bg-slate-50 p-2.5 text-sm">
                  <div className="font-medium text-slate-800">{atual.procedimento}</div>
                  <div className="text-xs text-slate-500">
                    {pacienteDe(atual).nome} · {hora(atual.inicio)}–{hora(atual.inicio + atual.duracao)} · {atual.cirurgiao}
                  </div>
                </div>
              )}
              <div className="text-xs text-slate-500">
                {proximo ? (
                  <>
                    Próximo: <span className="font-medium text-slate-700">{proximo.procedimento}</span> às {hora(proximo.inicio)}
                    {proximo.pendencias.length > 0 && (
                      <Chip className="ml-1 border-amber-300 bg-amber-50 text-amber-800">⚠ {proximo.pendencias.length} pendência(s)</Chip>
                    )}
                  </>
                ) : (
                  "Sem próximos casos hoje."
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="mt-4 p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-800">Pendências do dia</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="py-1.5 font-medium">Horário</th>
              <th className="py-1.5 font-medium">Sala</th>
              <th className="py-1.5 font-medium">Caso</th>
              <th className="py-1.5 font-medium">Pendência</th>
            </tr>
          </thead>
          <tbody>
            {pendencias.map((p, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="py-2 font-mono text-xs">{hora(p.caso.inicio)}</td>
                <td className="py-2">{p.caso.sala}</td>
                <td className="py-2">{p.caso.procedimento}</td>
                <td className="py-2 text-amber-800">⚠ {p.texto}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
