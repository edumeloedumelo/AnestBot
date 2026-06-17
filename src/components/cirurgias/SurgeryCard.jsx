import { Pencil, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export default function SurgeryCard({ surgery, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/30 transition-colors text-left"
      >
        <div>
          <h3 className="font-semibold text-foreground">{surgery.name}</h3>
          <p className="text-xs text-muted-foreground">{surgery.key}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {(surgery.required_exams || []).length} exames
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border px-5 py-4 space-y-3">
          <div>
            <p className="text-xs font-medium text-foreground/70 mb-2">Exames obrigatórios:</p>
            {surgery.required_exams?.length > 0 ? (
              <ul className="space-y-1">
                {surgery.required_exams.map((exam, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="text-primary mt-0.5">•</span>
                    {exam}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground italic">Nenhum exame definido</p>
            )}
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); onEdit(surgery); }} className="gap-1.5">
              <Pencil className="w-3.5 h-3.5" /> Editar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => { e.stopPropagation(); onDelete(surgery); }}
              className="gap-1.5 text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/10"
            >
              <Trash2 className="w-3.5 h-3.5" /> Excluir
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}