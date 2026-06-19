import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";

const statusEmojis = {
  "✅": "text-[#4CAF50]",
  "⚠️": "text-[#FFC107]",
  "❌": "text-[#FF5252]",
  "❓": "text-[#9E9E9E]",
};

export default function PainelResumo({ result }) {
  const [copied, setCopied] = useState(false);
  const {
    patientName = '',
    patientInfo = '',
    surgeryType = '',
    examResults = [],
    alerts = [],
    missingExams = [],
    finalStatus = '',
    conduct = '',
    blocoResumo = '',
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
      {/* Bloco Resumo — cartão principal para leitura rápida + cópia */}
      <div className="bg-[#1a1a1a] border border-[#2d2d2d] rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 bg-[#222]">
          <h2 className="text-xs font-extrabold text-white uppercase tracking-[0.15em]">
            📋 {patientName}
          </h2>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-extrabold uppercase tracking-wider ${statusColor}`}>
              {finalStatus}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyResumo}
              className="h-7 px-3 text-[10px] font-bold text-[#888] hover:text-white rounded-lg uppercase tracking-wider"
            >
              {copied ? <Check className="w-3.5 h-3.5 mr-1 text-[#4CAF50]" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
              {copied ? 'Copiado' : 'Copiar WhatsApp'}
            </Button>
          </div>
        </div>

        {/* Corpo — resumo compacto */}
        <div className="px-5 py-4">
          <div className="text-xs text-[#b3b3b3] space-y-1.5 mb-4">
            <div className="flex items-start gap-2">
              <span className="font-extrabold text-white uppercase tracking-wider text-[10px]">Cirurgia:</span>
              <span className="font-bold text-white">{surgeryType}</span>
            </div>
            {patientInfo && (
              <div className="flex items-start gap-2">
                <span className="font-extrabold text-white uppercase tracking-wider text-[10px]">Info:</span>
                <span className="font-semibold text-[#cccccc]">{patientInfo}</span>
              </div>
            )}
          </div>

          {/* Bloco resumo WhatsApp */}
          <pre className="text-xs font-semibold text-[#e0e0e0] whitespace-pre-wrap leading-snug font-sans select-all bg-[#121212] rounded-xl p-4 border border-[#222]">
            {blocoResumo}
          </pre>
        </div>
      </div>

      {/* Tabela de exames */}
      <div className="bg-[#1a1a1a] border border-[#2d2d2d] rounded-2xl overflow-hidden">
        <div className="px-5 py-2.5 flex items-center text-[10px] font-extrabold text-white uppercase tracking-wider bg-[#222]">
          <span className="flex-1">Exames</span>
          <span className="w-28 text-right">Resultado</span>
        </div>
        {examResults.map((row, i) => (
          <div
            key={i}
            className={`px-5 py-2 flex items-center text-xs border-t border-[#222] ${
              i % 2 === 0 ? 'bg-[#181818]' : 'bg-[#1a1a1a]'
            }`}
          >
            <span className="flex-1 font-bold text-[#e0e0e0]">{row.exam}</span>
            <span className={`w-28 text-right text-xs font-extrabold ${statusEmojis[row.status] || 'text-[#e0e0e0]'}`}>
              {row.status} {row.value && <span className="font-semibold text-[#888] ml-1">{row.value}</span>}
            </span>
          </div>
        ))}
      </div>

      {/* Alertas */}
      {alerts.length > 0 && (
        <div className="bg-[#1a1a1a] border border-[#2d2d2d] rounded-2xl overflow-hidden">
          <div className="px-5 py-3 bg-[#222]">
            <h3 className="text-[10px] font-extrabold text-white uppercase tracking-wider">🚨 Alertas</h3>
          </div>
          <div className="px-5 py-3">
            <ul className="space-y-2">
              {alerts.map((a, i) => (
                <li key={i} className={`text-xs font-bold leading-snug flex items-start gap-2 ${getSeverityColor(a)}`}>
                  <span className="mt-px flex-shrink-0">{getSeverityIcon(a)}</span>
                  <span className="text-[#e0e0e0]">{getAlertText(a)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Conduta */}
      {conduct && (
        <div className="bg-[#1a1a1a] border border-[#2d2d2d] rounded-2xl overflow-hidden">
          <div className="px-5 py-3 bg-[#222]">
            <h3 className="text-[10px] font-extrabold text-white uppercase tracking-wider">📋 Conduta</h3>
          </div>
          <div className="px-5 py-3">
            <p className="text-xs font-bold text-[#e0e0e0] leading-snug">{conduct}</p>
          </div>
        </div>
      )}
    </div>
  );
}