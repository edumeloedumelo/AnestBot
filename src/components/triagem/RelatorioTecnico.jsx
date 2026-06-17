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
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-muted/50">
        <h3 className="text-sm font-semibold text-foreground/80">
          📋 Relatório Técnico
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="h-8 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
        >
          {copied ? (
            <><Check className="w-3.5 h-3.5" /> Copiado</>
          ) : (
            <><Copy className="w-3.5 h-3.5" /> Copiar</>
          )}
        </Button>
      </div>
      <div className="p-5">
        <pre className="text-sm text-foreground/90 whitespace-pre-wrap font-mono leading-relaxed">
          {content}
        </pre>
      </div>
    </div>
  );
}