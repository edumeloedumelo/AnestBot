import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export default function RelatorioTecnico({ content, patientName }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!content) return null;

  return (
    <div className="bg-[#121212] border border-[#2d2d2d] rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#1a1a1a]">
        <h3 className="text-[10px] font-bold text-[#808080] uppercase tracking-[0.15em]">
          Relatório Técnico
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="h-7 text-[10px] gap-1.5 text-[#555] hover:text-white rounded-lg transition-colors uppercase tracking-wider"
        >
          {copied ? (
            <><Check className="w-3 h-3" /> Copiado</>
          ) : (
            <><Copy className="w-3 h-3" /> Copiar</>
          )}
        </Button>
      </div>
      <div className="p-5">
        <pre className="text-xs text-[#a0a0a0] whitespace-pre-wrap font-mono leading-relaxed">
          {content}
        </pre>
      </div>
    </div>
  );
}