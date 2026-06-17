import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export default function BlocoResumo({ content, patientName }) {
  const [copied, setCopied] = useState(false);

  // Clean up markdown code fences to get raw text for WhatsApp
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
    <div className="bg-white dark:bg-slate-900 border-2 border-blue-200 dark:border-blue-800 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40">
        <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-300">
          📱 Bloco-Resumo para WhatsApp
        </h3>
      </div>
      <div className="p-5">
        <pre className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">
          {cleanContent}
        </pre>
      </div>
      <div className="px-5 pb-5">
        <Button
          onClick={handleCopy}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white gap-2 h-11"
        >
          {copied ? (
            <>
              <Check className="w-4 h-4" /> Copiado para a área de transferência
            </>
          ) : (
            <>
              <Copy className="w-4 h-4" /> Copiar para WhatsApp
            </>
          )}
        </Button>
      </div>
    </div>
  );
}