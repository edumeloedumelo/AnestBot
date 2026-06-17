import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export default function BlocoResumo({ content, patientName }) {
  const [copied, setCopied] = useState(false);

  const cleanContent = content
    .replace(/^```[\s\S]*?\n/gm, "")
    .replace(/```$/gm, "")
    .trim();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(cleanContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!content) return null;

  return (
    <div className="bg-[#121212] border border-[#2d2d2d] rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#1a1a1a]">
        <h3 className="text-[10px] font-bold text-[#808080] uppercase tracking-[0.15em]">
          Resumo para WhatsApp
        </h3>
      </div>
      <div className="p-5">
        <pre className="text-xs text-[#a0a0a0] whitespace-pre-wrap font-body leading-relaxed">
          {cleanContent}
        </pre>
      </div>
      <div className="px-5 pb-5">
        <Button
          onClick={handleCopy}
          className="w-full bg-[#1a1a1a] hover:bg-[#252525] text-white gap-2 h-10 rounded-xl text-xs font-medium uppercase tracking-wider transition-colors border-0"
        >
          {copied ? (
            <><Check className="w-3.5 h-3.5" /> Copiado</>
          ) : (
            <><Copy className="w-3.5 h-3.5" /> Copiar para WhatsApp</>
          )}
        </Button>
      </div>
    </div>
  );
}