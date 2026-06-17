import { Loader2 } from "lucide-react";

export default function ProgressIndicator({ status }) {
  const steps = [
    { key: "uploading", label: "Enviando arquivos..." },
    { key: "analyzing", label: "Identificando pacientes e analisando exames..." },
  ];

  const currentIndex = steps.findIndex((s) => s.key === status);

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <Loader2 className="w-8 h-8 text-[#808080] animate-spin mb-6" />

      <div className="w-full max-w-xs space-y-4">
        {steps.map((step, i) => {
          const isDone = i < currentIndex;
          const isCurrent = i === currentIndex;
          const isPending = i > currentIndex;

          return (
            <div key={step.key} className="flex items-center gap-3">
              <div
                className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 text-[9px] font-bold transition-colors
                  ${isDone ? "bg-[#808080] text-white" : ""}
                  ${isCurrent ? "bg-[#1a1a1a] border border-[#555] text-[#808080]" : ""}
                  ${isPending ? "bg-[#0a0a0a] border border-[#1a1a1a] text-[#333]" : ""}
                `}
              >
                {isDone ? "✓" : isCurrent ? "●" : i + 1}
              </div>
              <span
                className={`text-xs uppercase tracking-wider transition-colors
                  ${isDone ? "text-[#555]" : ""}
                  ${isCurrent ? "text-white font-semibold" : ""}
                  ${isPending ? "text-[#333]" : ""}
                `}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-[#555] mt-8 text-center uppercase tracking-wider">
        Isso pode levar de 30 segundos a alguns minutos dependendo da quantidade de arquivos e pacientes
      </p>
    </div>
  );
}