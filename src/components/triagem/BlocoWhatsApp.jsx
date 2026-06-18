import { useState } from 'react';
import { Copy, CheckCircle2 } from "lucide-react";

export default function BlocoWhatsApp({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!text) return null;

  return (
    <div className="space-y-3">
      {/* Preview — balão estilo WhatsApp */}
      <div className="bg-[#075E54] rounded-2xl rounded-tl-sm p-4 max-w-md">
        <p className="text-[13px] text-white whitespace-pre-wrap leading-relaxed">
          {text}
        </p>
        <p className="text-[10px] text-[#a7d1c9] text-right mt-2">
          {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>

      {/* Botão de copiar */}
      <button
        onClick={handleCopy}
        className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold uppercase tracking-wider transition-all
          ${copied
            ? 'bg-[#25D366]/15 border border-[#25D366]/30 text-[#25D366]'
            : 'bg-[#25D366] hover:bg-[#20bd5a] text-black'
          }`}
      >
        {copied ? (
          <><CheckCircle2 className="w-4 h-4" /> Copiado!</>
        ) : (
          <><Copy className="w-4 h-4" /> Copiar para WhatsApp</>
        )}
      </button>
    </div>
  );
}