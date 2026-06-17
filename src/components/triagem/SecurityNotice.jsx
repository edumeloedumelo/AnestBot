import { Shield, AlertTriangle } from "lucide-react";

export default function SecurityNotice() {
  return (
    <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3">
      <div className="flex items-start gap-3">
        <Shield className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-xs text-amber-800 dark:text-amber-300 font-medium mb-1">
            Ferramenta de apoio à decisão
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
            Nenhum dado é armazenado — os arquivos são analisados e descartados. Não substitui a avaliação médica presencial. A responsabilidade clínica é do anestesiologista.
          </p>
        </div>
      </div>
    </div>
  );
}