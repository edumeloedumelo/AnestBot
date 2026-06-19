import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Copy, Check } from "lucide-react";

const statusEmojis = {
  "✅": "text-[#4CAF50]",
  "⚠️": "text-[#FFC107]",
  "❌": "text-[#FF5252]",
  "❓": "text-[#9E9E9E]",
};

const severityIcons = {
  "❌": "❌",
  "⚠️": "⚠️",
  "ℹ️": "ℹ️",
  "critico": "❌",
  "alerta": "⚠️",
  "informativo": "ℹ️",
};

export default function PainelResumo({ result }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
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
    medicationsToSuspend = [],
  } = result;

  const statusColor = finalStatus.includes('✅') ? 'text-[#4CAF50]' :
    finalStatus.includes('⚠️') ? 'text-[#FFC107]' :
    finalStatus.includes('🚨') ? 'text-[#FF5252]' : 'text-[#FF5252]';

  const getSeverityIcon = (alert) => {
    if (typeof alert === 'string') return '⚠️';
    const s = alert.severity || '';
    if (s.includes('❌') || s === 'critico') return '❌';
    if (s.includes('⚠️') || s === 'alerta') return '⚠️';
    return 'ℹ️';
  };

  const getSeverityColor = (alert) => {
    if (typeof alert === 'string') return 'text-[#FFC107]';
    const s = alert.severity || '';
    if (s.includes('❌') || s === 'critico') return 'text-[#FF5252]';
    if (s.includes('⚠️') || s === 'alerta') return 'text-[#FFC107]';
    return 'text-[#64B5F6]';
  };

  const getAlertText = (alert) => {
    if (typeof alert === 'string') return alert;
    return alert.text || alert.exam || '';
  };

  const handleCopyResumo = async () => {
    try {
      await navigator.clipboard.writeText(blocoResumo);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="space-y-3">
      {/* Card principal */}
      <div className="bg-[#1a1a1a] border border-[#2d2d2d] rounded-2xl overflow-hidden">
        {/* Cabeçalho */}
        <div className="px-5 pt-4 pb-4">
          <h2 className="text-sm font-bold text-white uppercase tracking-[0.1em] mb-3">📋 TRIAGEM PRÉ-OPERATÓRIA</h2>
          <div className="space-y-1.5 text-xs text-[#b3b3b3]">
            <div className="flex items-start gap-2">
              <span>👩‍⚕️</span>
              <span>Cirurgia: <span className="text-white">{surgeryType}</span></span>
            </div>
            <div className="flex items-start gap-2">
              <span>🧑</span>
              <span className="text-white">{patientName}{patientInfo ? ` — ${patientInfo}` : ''}</span>
            </div>
          </div>
        </div>

        {/* Tabela de exames */}
        <div className="border-t border-[#2d2d2d]">
          <div className="px-5 py-2.5 flex items-center text-[10px] font-bold text-white uppercase tracking-wider bg-[#222]">
            <span className="flex-1">ITEM</span>
            <span className="w-28 text-right">STATUS</span>
          </div>
          {examResults.map((row, i) => (
            <div
              key={i}
              className={`px-5 py-2.5 flex items-center text-xs border-t border-[#222] ${
                i % 2 === 0 ? 'bg-[#181818]' : 'bg-[#1a1a1a]'
              }`}
            >
              <span className="flex-1 text-[#cccccc]">{row.exam}</span>
              <span className={`w-28 text-right text-xs font-medium ${statusEmojis[row.status] || 'text-[#cccccc]'}`}>
                {row.status} {row.value && <span className="text-[#888] ml-1">{row.value}</span>}
              </span>
            </div>
          ))}
        </div>

        {/* Alertas */}
        {alerts.length > 0 && (
          <div className="border-t border-[#2d2d2d] px-5 py-4">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-3">🚨 ALERTAS / ALTERAÇÕES</h3>
            <ul className="space-y-2.5">
              {alerts.map((a, i) => (
                <li key={i} className={`text-xs leading-relaxed flex items-start gap-2 ${getSeverityColor(a)}`}>
                  <span className="mt-px flex-shrink-0">{getSeverityIcon(a)}</span>
                  <span className="text-[#cccccc]">{getAlertText(a)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Status final + Conduta */}
        <div className="border-t border-[#2d2d2d] px-5 py-4 space-y-3">
          <div>
            <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-1.5">📌 STATUS FINAL</h3>
            <p className={`text-sm font-bold ${statusColor}`}>{finalStatus}</p>
          </div>
          {conduct && (
            <div>
              <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-1.5">📋 CONDUTA</h3>
              <p className="text-xs text-[#cccccc] leading-relaxed">{conduct}</p>
            </div>
          )}
        </div>
      </div>

      {/* Bloco Resumo — fácil de copiar */}
      <div className="bg-[#1a1a1a] border border-[#2d2d2d] rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 bg-[#222]">
          <h3 className="text-[10px] font-bold text-white uppercase tracking-[0.15em]">📋 RESUMO PARA WHATSAPP</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopyResumo}
            className="h-7 px-3 text-[10px] text-[#888] hover:text-white rounded-lg"
          >
            {copied ? <Check className="w-3.5 h-3.5 mr-1 text-[#4CAF50]" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
            {copied ? 'Copiado' : 'Copiar'}
          </Button>
        </div>
        <div className="px-5 py-4">
          <pre className="text-xs text-[#cccccc] whitespace-pre-wrap leading-relaxed font-sans select-all">
            {blocoResumo}
          </pre>
        </div>
      </div>

      {/* Relatório técnico completo */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setExpanded(!expanded)}
        className="text-[#666] hover:text-white text-[10px] h-8 px-3 rounded-lg bg-[#1a1a1a] border border-[#2d2d2d] uppercase tracking-wider"
      >
        {expanded ? <ChevronUp className="w-3 h-3 mr-1.5" /> : <ChevronDown className="w-3 h-3 mr-1.5" />}
        {expanded ? 'Ocultar' : 'Relatório técnico completo'}
      </Button>

      {expanded && relatorioTecnico && (
        <div className="bg-[#1a1a1a] border border-[#2d2d2d] rounded-2xl p-5">
          <pre className="text-xs text-[#cccccc] whitespace-pre-wrap leading-relaxed font-sans">
            {relatorioTecnico}
          </pre>
        </div>
      )}
    </div>
  );
}