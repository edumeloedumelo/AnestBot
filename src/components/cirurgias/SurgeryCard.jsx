import { Pencil, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export default function SurgeryCard({ surgery, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-[#121212] border border-[#2d2d2d] rounded-2xl overflow-hidden transition-colors">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#1a1a1a] transition-colors text-left"
      >
        <div>
          <h3 className="font-semibold text-white uppercase tracking-wider text-sm">{surgery.name}</h3>
          <p className="text-[11px] text-[#555]">{surgery.key}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#555] uppercase tracking-wider">
            {(surgery.required_exams || []).length} exames
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-[#555]" /> : <ChevronDown className="w-4 h-4 text-[#555]" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[#1a1a1a] px-5 py-4 space-y-3">
          <div>
            <p className="text-[10px] font-semibold text-[#808080] uppercase tracking-wider mb-2">Exames obrigatórios:</p>
            {surgery.required_exams?.length > 0 ? (
              <ul className="space-y-1">
                {surgery.required_exams.map((exam, i) => (
                  <li key={i} className="text-sm text-[#a0a0a0] flex items-start gap-2">
                    <span className="text-[#808080] mt-0.5">•</span>
                    {exam}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[#555]">Nenhum exame definido</p>
            )}
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); onEdit(surgery); }} className="gap-1.5 rounded-xl border-[#2d2d2d] text-[#a0a0a0] hover:text-white hover:border-[#555] bg-transparent text-[10px] uppercase tracking-wider">
              <Pencil className="w-3.5 h-3.5" /> Editar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => { e.stopPropagation(); onDelete(surgery); }}
              className="gap-1.5 rounded-xl text-[#f87171] border-[#3a1515] hover:bg-[#3a1515]/50 bg-transparent text-[10px] uppercase tracking-wider"
            >
              <Trash2 className="w-3.5 h-3.5" /> Excluir
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}