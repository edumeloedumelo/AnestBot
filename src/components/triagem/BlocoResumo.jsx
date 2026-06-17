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
    <div className="bg-card border-2 border-primary/40 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-primary/20 bg-primary/10">
        <h3 className="text-sm font-semibold text-primary">
          📱 Resumo para WhatsApp
        </h3>
      </div>
      <div className="p-5">
        <pre className="text-sm text-foreground/90 whitespace-pre-wrap font-sans leading-relaxed">
          {cleanContent}
        </pre>
      </div>
      <div className="px-5 pb-5">
        <Button
          onClick={handleCopy}
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground gap-2 h-11"
        >
          {copied ? (
            <><Check className="w-4 h-4" /> Copiado para a área de transferência</>
          ) : (
            <><Copy className="w-4 h-4" /> Copiar para WhatsApp</>
          )}
        </Button>
      </div>
    </div>
  );
}