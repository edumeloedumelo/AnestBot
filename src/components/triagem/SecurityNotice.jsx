import { Shield } from "lucide-react";

export default function SecurityNotice() {
  return (
    <div className="bg-primary/10 border border-primary/30 rounded-lg px-4 py-3">
      <div className="flex items-start gap-3">
        <Shield className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-xs text-foreground/90 font-medium mb-1">
            Ferramenta de apoio à decisão
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Nenhum dado é armazenado — os arquivos são analisados e descartados. Não substitui a avaliação médica presencial. A responsabilidade clínica é do anestesiologista.
          </p>
        </div>
      </div>
    </div>
  );
}