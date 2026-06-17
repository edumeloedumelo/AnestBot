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
    <div className="bg-[#121212] border border-[#2d2d2d] rounded-2xl px-4 py-3 flex items-center justify-between gap-3 transition-colors">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h4 className="font-semibold text-sm text-white uppercase tracking-wider">{limit.exam_name}</h4>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#1a1a1a] text-[#808080] uppercase font-semibold tracking-wider">
            {ruleTypeLabels[limit.rule_type] || limit.rule_type}
          </span>
          {limit.unit && <span className="text-[10px] text-[#555]">{limit.unit}</span>}
        </div>
        <p className="text-sm text-[#808080] font-medium mt-0.5">{limit.description}</p>
        {limit.notes && <p className="text-[11px] text-[#555] mt-1 truncate">{limit.notes}</p>}
      </div>

      <div className="flex gap-1 flex-shrink-0">
        <Button variant="ghost" size="icon" onClick={() => onEdit(limit)} className="h-7 w-7 text-[#555] hover:text-white">
          <Pencil className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => onDelete(limit)} className="h-7 w-7 text-[#555] hover:text-[#f87171]">
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}