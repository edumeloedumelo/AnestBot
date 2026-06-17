import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const ruleTypeLabels = {
  min: "Mín",
  max: "Máx",
  range: "Faixa",
  flag: "Flag",
  interpretation: "Interp.",
};

export default function ExamLimitCard({ limit, onEdit, onDelete }) {
  return (
    <div className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-2xl px-4 py-3 flex items-center justify-between gap-3 shadow-sm transition-all duration-300 hover:shadow-md">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h4 className="font-medium text-sm text-foreground">{limit.exam_name}</h4>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase font-medium">
            {ruleTypeLabels[limit.rule_type] || limit.rule_type}
          </span>
          {limit.unit && <span className="text-[10px] text-muted-foreground/60">{limit.unit}</span>}
        </div>
        <p className="text-sm text-primary font-medium mt-0.5">{limit.description}</p>
        {limit.notes && <p className="text-xs text-muted-foreground mt-1 truncate">{limit.notes}</p>}
      </div>

      <div className="flex gap-1 flex-shrink-0">
        <Button variant="ghost" size="icon" onClick={() => onEdit(limit)} className="h-7 w-7 text-muted-foreground hover:text-foreground">
          <Pencil className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => onDelete(limit)} className="h-7 w-7 text-muted-foreground hover:text-destructive">
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}