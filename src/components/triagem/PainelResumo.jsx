import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Copy, Check, RefreshCw, ShieldAlert } from "lucide-react";

export default function PainelResumo({ result }) {
  const [copied, setCopied] = useState(false);
  const {
    patientName = '',
    patientInfo = '',
    surgeryName = '',
    surgeryType = '',
    isRevision = false,
    examResults = [],
    alerts = [],
    missingExams = [],
    finalStatus = '',
    conduct = '',
    blocoResumo = '',
  } = result || {};

  const statusColor = finalStatus.includes('✅') ? 'text-[#4CAF50]' :
    finalStatus.includes('⚠️') ? 'text-[#FFC107]' :
    finalStatus.includes('🚨') ? 'text-[#FF5252]' : 'text-[#FF5252]';

  const statusBg = finalStatus.includes('✅') ? 'bg-[#4CAF50]/15 border-[#4CAF50]/30' :
    finalStatus.includes('⚠️') ? 'bg-[#FFC107]/15 border-[#FFC107]/30' :
    finalStatus.includes('🚨') ? 'bg-[#FF5252]/15 border-[#FF5252]/30' : 'bg-[#FF5252]/15 border-[#FF5252]/30';

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
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 bg-[#222]">
          <div className="flex items-center gap-3">
            <h2 className="text-xs font-extrabold text-white uppercase tracking-[0.15em]">
              📋 {patientName}
            </h2>
            {isRevision && (
              <span className="px-2.5 py-0.5 rounded-full bg-[#FFC107]/15 border border-[#FFC107]/30 text-[10px] font-extrabold text-[#FFC107] uppercase tracking-wider flex items-center gap-1">
                <RefreshCw className="w-3 h-3" /> Revisão
              </span>
            )}
          </div>
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

        {/* Corpo */}
        <div className="px-5 py-4">
          {/* Alerta de revisão */}
          {isRevision && (
            <div className="flex items-start gap-2 p-3 mb-4 bg-[#FFC107]/5 border border-[#FFC107]/15 rounded-xl">
              <ShieldAlert className="w-4 h-4 text-[#FFC107] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[11px] font-extrabold text-[#FFC107] uppercase tracking-wider mb-0.5">
                  Classificado como Revisão
                </p>
                <p className="text-[10px] text-[#a0a0a0] leading-relaxed">
                  Exames de imagem dispensados. Apenas exames de sangue são informados com data, sem travar.
                </p>
              </div>
            </div>
          )}

          <div className="text-xs text-[#b3b3b3] space-y-1.5 mb-4">
            <div className="flex items-start gap-2">
              <span className="font-extrabold text-white uppercase tracking-wider text-[10px]">Cirurgia:</span>
              <span className="font-bold text-white">{surgeryName || surgeryType || 'Não identificada'}</span>
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
      {examResults.length > 0 && (
        <div className="bg-[#1a1a1a] border border-[#2d2d2d] rounded-2xl overflow-hidden">
          <div className="px-5 py-2.5 flex items-center text-[10px] font-extrabold text-white uppercase tracking-wider bg-[#222]">
            <span className="flex-1">Exame</span>
            <span className="w-40 text-right">Resultado</span>
          </div>
          {examResults.map((row, i) => (
            <div
              key={i}
              className={`px-5 py-2.5 flex items-center text-xs border-t border-[#222] ${
                i % 2 === 0 ? 'bg-[#181818]' : 'bg-[#1a1a1a]'
              }`}
            >
              <span className="flex-1 font-bold text-[#e0e0e0]">{row.exam}</span>
              <span className="w-40 text-right text-xs font-extrabold text-[#e0e0e0]">
                {row.status} {row.value && <span className="font-semibold text-[#888] ml-1">{row.value}</span>}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Alertas */}
      {alerts.length > 0 && (
        <div className="bg-[#1a1a1a] border border-[#2d2d2d] rounded-2xl overflow-hidden">
          <div className="px-5 py-3 bg-[#222]">
            <h3 className="text-[10px] font-extrabold text-white uppercase tracking-wider">🚨 Alertas</h3>
          </div>
          <div className="px-5 py-3">
            <ul className="space-y-2">
              {alerts.map((a, i) => (
                <li key={i} className="text-xs font-bold leading-snug flex items-start gap-2 text-[#e0e0e0]">
                  <span className="mt-px flex-shrink-0">{a.severity || '⚠️'}</span>
                  <span>{a.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Exames pendentes */}
      {missingExams.length > 0 && !isRevision && (
        <div className="bg-[#1a1a1a] border border-[#2d2d2d] rounded-2xl overflow-hidden">
          <div className="px-5 py-3 bg-[#222]">
            <h3 className="text-[10px] font-extrabold text-white uppercase tracking-wider">❌ Exames pendentes</h3>
          </div>
          <div className="px-5 py-3">
            <ul className="space-y-1">
              {missingExams.map((exam, i) => (
                <li key={i} className="text-xs font-bold text-[#ff8888]">{exam}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Conduta */}
      {conduct && (
        <div className={`p-4 rounded-2xl border ${statusBg}`}>
          <h3 className="text-[10px] font-extrabold text-white uppercase tracking-wider mb-2">📋 Conduta</h3>
          <p className="text-xs font-bold text-[#e0e0e0] leading-snug">{conduct}</p>
        </div>
      )}
    </div>
  );
}