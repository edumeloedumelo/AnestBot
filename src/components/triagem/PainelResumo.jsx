import { useState, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Copy, Check, RefreshCw, ShieldAlert, AlertTriangle } from "lucide-react";

const EMOJI_COLORS = {
  '✅': { bg: 'bg-[#4CAF50]/10', text: 'text-[#4CAF50]' },
  '⚠️': { bg: 'bg-[#FFC107]/10', text: 'text-[#FFC107]' },
  '❌': { bg: 'bg-[#FF5252]/10', text: 'text-[#FF5252]' },
  '❓': { bg: 'bg-[#888]/10', text: 'text-[#999]' },
  '🚨': { bg: 'bg-[#FF5252]/15', text: 'text-[#FF5252]' },
  'ℹ️': { bg: 'bg-[#2196F3]/10', text: 'text-[#2196F3]' },
  '🔄': { bg: 'bg-[#FF9800]/10', text: 'text-[#FF9800]' },
};

function parseTabelaRows(tabela) {
  const lines = tabela.split('\n').filter(l => l.trim());
  const rows = [];
  for (const line of lines) {
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length >= 2 && !cells[0].startsWith('-') && cells[0] !== 'Exame') {
      rows.push(cells);
    }
  }
  return rows;
}

export default function PainelResumo({ result }) {
  const [copied, setCopied] = useState(false);
  const {
    patientName = '',
    patientInfo = '',
    surgeryName = '',
    surgeryType = '',
    isRevision = false,
    relatorioTabela = '',
    examResults = [],
    alerts = [],
    missingExams = [],
    medicationsToSuspend = [],
    finalStatus = '',
    conduct = '',
    blocoResumo = '',
    unsupportedFilesNote = '',
  } = result || {};

  const tabelaRows = useMemo(() => parseTabelaRows(relatorioTabela), [relatorioTabela]);

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

  const getRowEmoji = (cells) => {
    for (const cell of cells) {
      for (const emoji of Object.keys(EMOJI_COLORS)) {
        if (cell.startsWith(emoji)) return emoji;
      }
    }
    return null;
  };

  return (
    <div className="space-y-3">
      {/* 1. Badge de revisão — topo */}
      {isRevision && (
        <div className="flex items-start gap-3 p-4 bg-[#FF9800]/10 border border-[#FF9800]/25 rounded-2xl">
          <ShieldAlert className="w-5 h-5 text-[#FF9800] flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-extrabold text-[#FF9800] uppercase tracking-wider mb-1">
              🔄 Revisão / Reparo / Retoque
            </p>
            <p className="text-[11px] text-[#c0c0c0] leading-relaxed">
              Procedimento classificado como revisão ou reparo de cirurgia anterior. Exames de imagem, RX de tórax e ECG foram dispensados — ausência desses exames não gera pendência.
            </p>
          </div>
        </div>
      )}

      {/* 2. Aviso de arquivo não processado */}
      {unsupportedFilesNote && (
        <div className="flex items-start gap-2 p-3 bg-[#1a1a00] border border-[#333300] rounded-xl">
          <AlertTriangle className="w-4 h-4 text-[#FFC107] flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-[#FFC107] leading-snug">{unsupportedFilesNote}</p>
        </div>
      )}

      {/* 3. Card principal — cabeçalho + tabela */}
      <div className="bg-[#1a1a1a] border border-[#2d2d2d] rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 bg-[#222]">
          <div className="flex items-center gap-3">
            <h2 className="text-xs font-extrabold text-white uppercase tracking-[0.15em]">
              📋 {patientName}
            </h2>
            {isRevision && (
              <span className="px-2.5 py-0.5 rounded-full bg-[#FF9800]/15 border border-[#FF9800]/30 text-[10px] font-extrabold text-[#FF9800] uppercase tracking-wider flex items-center gap-1">
                <RefreshCw className="w-3 h-3" /> Revisão
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <span className="text-[10px] font-extrabold text-white uppercase tracking-wider block">
                {surgeryName || surgeryType || 'Não identificada'}
              </span>
              {patientInfo && (
                <span className="text-[10px] text-[#888]">{patientInfo}</span>
              )}
            </div>
          </div>
        </div>

        {/* 4. Tabela 🔬 Exames */}
        <div className="px-5 py-4">
          <h3 className="text-[10px] font-extrabold text-white uppercase tracking-wider mb-3">🔬 Exames</h3>

          {tabelaRows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#222]">
                    <th className="text-left py-2 pr-3 text-[10px] font-extrabold text-[#888] uppercase tracking-wider">Exame</th>
                    <th className="text-center py-2 px-2 w-12 text-[10px] font-extrabold text-[#888] uppercase tracking-wider">Status</th>
                    <th className="text-left py-2 pl-3 text-[10px] font-extrabold text-[#888] uppercase tracking-wider">Valor / Observação</th>
                  </tr>
                </thead>
                <tbody>
                  {tabelaRows.map((cells, i) => {
                    const emoji = getRowEmoji(cells);
                    const colors = emoji ? EMOJI_COLORS[emoji] : { bg: '', text: 'text-[#e0e0e0]' };
                    const exam = cells[0] ? cells[0].replace(/^[^\w]+/, '').trim() : '';
                    const status = cells[1] || '';
                    const value = cells[2] || '';
                    return (
                      <tr key={i} className={`border-b border-[#1a1a1a] ${colors.bg}`}>
                        <td className="py-2.5 pr-3 font-bold text-[#e0e0e0]">{exam}</td>
                        <td className={`py-2.5 px-2 text-center font-extrabold ${colors.text}`}>{status}</td>
                        <td className={`py-2.5 pl-3 font-semibold ${colors.text}`}>{value}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : examResults.length > 0 ? (
            <div className="space-y-1">
              {examResults.map((row, i) => (
                <div key={i} className={`flex items-center justify-between py-2 px-3 rounded-lg ${i % 2 === 0 ? 'bg-[#181818]' : ''}`}>
                  <span className="font-bold text-[#e0e0e0] text-xs">{row.exam}</span>
                  <span className={`text-xs font-extrabold ${EMOJI_COLORS[row.status]?.text || 'text-[#e0e0e0]'}`}>
                    {row.status} {row.value ? <span className="font-semibold text-[#888] ml-1">{row.value}</span> : ''}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-[#555] text-center py-4">Nenhum exame processado</p>
          )}
        </div>
      </div>

      {/* 5. Alertas 🚨 */}
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

      {/* 6. Medicações 💊 a Suspender */}
      {medicationsToSuspend.length > 0 && (
        <div className="bg-[#1a1a1a] border border-[#2d2d2d] rounded-2xl overflow-hidden">
          <div className="px-5 py-3 bg-[#222]">
            <h3 className="text-[10px] font-extrabold text-white uppercase tracking-wider">💊 Medicações a Suspender</h3>
          </div>
          <div className="px-5 py-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#222]">
                  <th className="text-left py-2 text-[10px] font-extrabold text-[#888] uppercase tracking-wider">Medicação</th>
                  <th className="text-left py-2 pl-4 text-[10px] font-extrabold text-[#888] uppercase tracking-wider">Suspender</th>
                </tr>
              </thead>
              <tbody>
                {medicationsToSuspend.map((m, i) => (
                  <tr key={i} className="border-b border-[#1a1a1a]">
                    <td className="py-2 font-bold text-[#e0e0e0]">{m.medication}</td>
                    <td className="py-2 pl-4 font-semibold text-[#FFC107]">{m.suspend}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 7. Conduta 📋 */}
      {conduct && (
        <div className={`p-4 rounded-2xl border ${statusBg}`}>
          <h3 className="text-[10px] font-extrabold text-white uppercase tracking-wider mb-2">📋 Conduta</h3>
          <p className="text-xs font-bold text-[#e0e0e0] leading-snug">{conduct}</p>
        </div>
      )}

      {/* 8. Status final + Bloco WhatsApp 💬 */}
      <div className="bg-[#1a1a1a] border border-[#2d2d2d] rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 bg-[#222]">
          <h3 className="text-[10px] font-extrabold text-white uppercase tracking-wider">💬 Bloco WhatsApp</h3>
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
              {copied ? 'Copiado' : 'Copiar'}
            </Button>
          </div>
        </div>
        <div className="px-5 py-4">
          <pre className="text-xs font-semibold text-[#e0e0e0] whitespace-pre-wrap leading-snug font-sans select-all bg-[#121212] rounded-xl p-4 border border-[#222]">
            {blocoResumo}
          </pre>
        </div>
      </div>
    </div>
  );
}