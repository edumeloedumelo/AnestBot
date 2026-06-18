import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";
import BlocoWhatsApp from "@/components/triagem/BlocoWhatsApp";

const statusEmojis = {
  "✅": "text-[#4CAF50]",
  "⚠️": "text-[#FFC107]",
  "❌": "text-[#FF5252]",
  "❓": "text-[#9E9E9E]",
};

export default function PainelResumo({ result }) {
  const [expanded, setExpanded] = useState(false);
  const {
    patientName = '',
    patientInfo = '',
    surgeryType = '',
    examResults = [],
    alerts = [],
    missingExams = [],
    alteredExams = [],
    finalStatus = '',
    conduct = '',
    blocoResumo = '',
    relatorioTecnico = '',
  } = result;

  const statusColor = finalStatus.includes('✅') ? 'text-[#4CAF50]' :
    finalStatus.includes('⚠️') ? 'text-[#FFC107]' :
    finalStatus.includes('🚨') ? 'text-[#FF5252]' : 'text-[#FF5252]';

  return (
    <div className="space-y-4">
      {/* Card principal */}
      <div className="bg-[#1a1a1a] border border-[#2d2d2d] rounded-2xl overflow-hidden">
        {/* Cabeçalho */}
        <div className="px-5 pt-5 pb-4">
          <h2 className="text-base font-bold text-white mb-3">📋 TRIAGEM PRÉ-OPERATÓRIA</h2>
          <div className="space-y-2 text-sm text-[#e0e0e0]">
            <div className="flex items-start gap-2">
              <span>👱‍♀️</span>
              <span className="leading-relaxed">Cirurgia: {surgeryType}</span>
            </div>
            <div className="flex items-start gap-2">
              <span>👤</span>
              <span className="leading-relaxed">{patientName}{patientInfo ? `, ${patientInfo}` : ''}</span>
            </div>
          </div>
        </div>

        {/* Resumo rápido: faltantes + alterados */}
        {(missingExams.length > 0 || alteredExams.length > 0) && (
          <div className="border-t border-[#2d2d2d] px-5 py-4">
            <div className="grid grid-cols-2 gap-4">
              {missingExams.length > 0 && (
                <div>
                  <h3 className="text-[11px] font-bold text-[#FF5252] uppercase tracking-wider mb-2">❌ Faltantes</h3>
                  <ul className="space-y-1">
                    {missingExams.map((e, i) => (
                      <li key={i} className="text-xs text-[#e0e0e0]">{e}</li>
                    ))}
                  </ul>
                </div>
              )}
              {alteredExams.length > 0 && (
                <div>
                  <h3 className="text-[11px] font-bold text-[#FFC107] uppercase tracking-wider mb-2">⚠️ Alterados</h3>
                  <ul className="space-y-1">
                    {alteredExams.map((e, i) => (
                      <li key={i} className="text-xs text-[#e0e0e0]">{e}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tabela de exames */}
        <div className="border-t border-[#2d2d2d]">
          <div className="px-5 py-3 flex items-center text-xs font-bold text-white uppercase tracking-wider bg-[#1e1e1e]">
            <span className="flex-1">ITEM</span>
            <span className="w-32 text-right">STATUS</span>
          </div>
          {examResults.map((row, i) => (
            <div
              key={i}
              className={`px-5 py-3 flex items-center text-sm border-t border-[#222] ${
                i % 2 === 0 ? 'bg-[#161616]' : 'bg-[#1a1a1a]'
              }`}
            >
              <span className="flex-1 text-[#e0e0e0]">{row.exam}</span>
              <span className={`w-32 text-right text-xs ${statusEmojis[row.status] || 'text-[#e0e0e0]'}`}>
                {row.status} {row.value}
              </span>
            </div>
          ))}
        </div>

        {/* Alertas */}
        {alerts.length > 0 && (
          <div className="border-t border-[#2d2d2d] px-5 py-4">
            <h3 className="text-sm font-bold text-white mb-2">🚨 ALERTAS / ALTERAÇÕES</h3>
            <ul className="space-y-1.5">
              {alerts.map((a, i) => (
                <li key={i} className="text-xs text-[#e0e0e0] leading-relaxed flex items-start gap-1.5">
                  <span className="text-[#FF5252] mt-0.5">•</span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Status final + Conduta */}
        <div className="border-t border-[#2d2d2d] px-5 py-4 space-y-3">
          <div>
            <h3 className="text-sm font-bold text-white mb-1">📌 STATUS FINAL</h3>
            <p className={`text-sm font-bold ${statusColor}`}>{finalStatus}</p>
          </div>
          {conduct && (
            <div>
              <h3 className="text-sm font-bold text-white mb-1">📋 CONDUTA</h3>
              <p className="text-xs text-[#e0e0e0] leading-relaxed">{conduct}</p>
            </div>
          )}
        </div>
      </div>

      {/* Bloco WhatsApp — copiar resumo */}
      <BlocoWhatsApp text={blocoResumo} />

      {/* Botão expandir relatório técnico */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setExpanded(!expanded)}
        className="text-[#808080] hover:text-white text-xs h-8 px-3 rounded-lg bg-[#1a1a1a] border border-[#2d2d2d]"
      >
        {expanded ? <ChevronUp className="w-3.5 h-3.5 mr-1.5" /> : <ChevronDown className="w-3.5 h-3.5 mr-1.5" />}
        {expanded ? 'Ocultar' : 'Relatório técnico completo'}
      </Button>

      {/* Relatório expandido */}
      {expanded && relatorioTecnico && (
        <div className="bg-[#1a1a1a] border border-[#2d2d2d] rounded-2xl p-5">
          <pre className="text-xs text-[#e0e0e0] whitespace-pre-wrap leading-relaxed font-sans">
            {relatorioTecnico}
          </pre>
        </div>
      )}

    </div>
  );
}