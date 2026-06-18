import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Copy, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";

const statusEmojis = {
  "✅": "text-[#4CAF50]",
  "⚠️": "text-[#FFC107]",
  "❌": "text-[#FF5252]",
  "❓": "text-[#9E9E9E]",
};

export default function PainelResumo({ result }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async (text) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const {
    patientName = '',
    patientInfo = '',
    surgeryType = '',
    examResults = [],
    alerts = [],
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

      {/* Botão expandir relatório técnico */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(!expanded)}
          className="text-[#808080] hover:text-white text-xs h-8 px-3 rounded-lg bg-[#1a1a1a] border border-[#2d2d2d]"
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5 mr-1.5" /> : <ChevronDown className="w-3.5 h-3.5 mr-1.5" />}
          {expanded ? 'Ocultar' : 'Relatório técnico completo'}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleCopy(blocoResumo)}
          className="text-[#808080] hover:text-white text-xs h-8 px-3 rounded-lg bg-[#1a1a1a] border border-[#2d2d2d]"
        >
          {copied ? <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 text-[#4CAF50]" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
          {copied ? 'Copiado' : 'Copiar resumo'}
        </Button>
      </div>

      {/* Relatório expandido */}
      {expanded && relatorioTecnico && (
        <div className="bg-[#1a1a1a] border border-[#2d2d2d] rounded-2xl p-5">
          <pre className="text-xs text-[#e0e0e0] whitespace-pre-wrap leading-relaxed font-sans">
            {relatorioTecnico}
          </pre>
        </div>
      )}

      {/* Bloco resumo WhatsApp (sempre visível, mais compacto) */}
      {blocoResumo && (
        <div className="bg-[#1a1a1a] border border-[#2d2d2d] rounded-xl p-4">
          <p className="text-[10px] text-[#808080] uppercase tracking-wider mb-2">📱 Resumo WhatsApp</p>
          <pre className="text-xs text-[#e0e0e0] whitespace-pre-wrap leading-relaxed font-sans">
            {blocoResumo}
          </pre>
        </div>
      )}
    </div>
  );
}