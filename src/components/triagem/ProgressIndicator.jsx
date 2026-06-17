import { Loader2 } from "lucide-react";

export default function ProgressIndicator({ status }) {
  const steps = [
    { key: "uploading", label: "Enviando arquivos..." },
    { key: "analyzing", label: "Identificando pacientes e analisando exames..." },
  ];

  const currentIndex = steps.findIndex((s) => s.key === status);

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4">
      <Loader2 className="w-10 h-10 text-blue-600 dark:text-blue-400 animate-spin mb-6" />

      <div className="w-full max-w-xs space-y-3">
        {steps.map((step, i) => {
          const isDone = i < currentIndex;
          const isCurrent = i === currentIndex;
          const isPending = i > currentIndex;

          return (
            <div key={step.key} className="flex items-center gap-3">
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold transition-colors
                  ${isDone ? "bg-blue-600 text-white" : ""}
                  ${isCurrent ? "bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400" : ""}
                  ${isPending ? "bg-slate-100 dark:bg-slate-800 text-slate-400" : ""}
                `}
              >
                {isDone ? "✓" : isCurrent ? "●" : i + 1}
              </div>
              <span
                className={`text-sm transition-colors
                  ${isDone ? "text-slate-500 dark:text-slate-400" : ""}
                  ${isCurrent ? "text-slate-700 dark:text-slate-200 font-medium" : ""}
                  ${isPending ? "text-slate-400 dark:text-slate-500" : ""}
                `}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-slate-400 dark:text-slate-500 mt-6 text-center">
        Isso pode levar de 30 segundos a alguns minutos dependendo da quantidade de arquivos e pacientes
      </p>
    </div>
  );
}