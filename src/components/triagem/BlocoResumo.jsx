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
    <div className="bg-card/90 backdrop-blur-sm border border-border/50 rounded-3xl overflow-hidden shadow-lg shadow-black/5">
      <div className="flex items-center justify-between px-5 py-3 border-b border-primary/10 bg-primary/5">
        <h3 className="text-sm font-semibold text-primary/90 font-heading tracking-wide">
          Resumo para WhatsApp
        </h3>
      </div>
      <div className="p-5">
        <pre className="text-sm text-foreground/85 whitespace-pre-wrap font-body leading-relaxed">
          {cleanContent}
        </pre>
      </div>
      <div className="px-5 pb-5">
        <Button
          onClick={handleCopy}
          className="w-full bg-foreground hover:bg-foreground/90 text-background gap-2 h-12 rounded-2xl font-medium shadow-lg shadow-foreground/5 transition-all duration-300"
        >
          {copied ? (
            <><Check className="w-4 h-4" /> Copiado</>
          ) : (
            <><Copy className="w-4 h-4" /> Copiar para WhatsApp</>
          )}
        </Button>
      </div>
    </div>
  );
}