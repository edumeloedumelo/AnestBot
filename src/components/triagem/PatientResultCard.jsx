import { useState } from "react";
import { Copy, Check, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PatientResultCard({ result, index }) {
  const [expanded, setExpanded] = useState(false);
  const [copiedResumo, setCopiedResumo] = useState(false);
  const [copiedRelatorio, setCopiedRelatorio] = useState(false);

  const { patientName, surgeryType, relatorioTecnico, blocoResumo } = result;

  const cleanResumo = (blocoResumo || "")
    .replace(/^```[\s\S]*?\n/gm, "")
    .replace(/```$/gm, "")
    .trim();

  const surgeryLabels = {
    protese_mamaria: "Prótese Mamária",
    mastopexia: "Mastopexia",
    abdominoplastia: "Abdominoplastia",
    lipoaspiracao: "Lipoaspiração",
    combinada: "Combinada",
    indefinida: "Não identificada",
  };

  const handleCopyResumo = async () => {
    await navigator.clipboard.writeText(cleanResumo);
    setCopiedResumo(true);
    setTimeout(() => setCopiedResumo(false), 2000);
  };

  const handleCopyRelatorio = async () => {
    await navigator.clipboard.writeText(relatorioTecnico || "");
    setCopiedRelatorio(true);
    setTimeout(() => setCopiedRelatorio(false), 2000);
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-sm font-bold text-blue-700 dark:text-blue-300">
            {index + 1}
          </div>
          <div>
            <h3 className="font-semibold text-slate-800 dark:text-slate-100">
              {patientName}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {surgeryLabels[surgeryType] || surgeryType}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-slate-400">
          <span className="text-xs text-slate-400 dark:text-slate-500 hidden sm:inline">
            {expanded ? "Recolher" : "Expandir"}
          </span>
          {expanded ? (
            <ChevronUp className="w-5 h-5" />
          ) : (
            <ChevronDown className="w-5 h-5" />
          )}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-slate-200 dark:border-slate-700 p-5 space-y-4">
          {/* WhatsApp Summary */}
          {blocoResumo && (
            <div className="border-2 border-blue-200 dark:border-blue-800 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40">
                <h4 className="text-xs font-semibold text-blue-800 dark:text-blue-300">
                  📱 Resumo WhatsApp
                </h4>
              </div>
              <div className="p-4">
                <pre className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">
                  {cleanResumo}
                </pre>
              </div>
              <div className="px-4 pb-4">
                <Button
                  onClick={handleCopyResumo}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white gap-2 h-10 text-sm"
                >
                  {copiedResumo ? (
                    <>
                      <Check className="w-4 h-4" /> Copiado
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" /> Copiar para WhatsApp
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Technical Report */}
          {relatorioTecnico && (
            <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  📋 Relatório Técnico
                </h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopyRelatorio}
                  className="h-7 text-xs gap-1 text-slate-500 hover:text-slate-700"
                >
                  {copiedRelatorio ? (
                    <>
                      <Check className="w-3 h-3" /> Copiado
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" /> Copiar
                    </>
                  )}
                </Button>
              </div>
              <div className="p-4">
                <pre className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
                  {relatorioTecnico}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}