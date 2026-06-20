import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Trash2, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

export default function ClearHistoryButton({ onCleared }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleClear = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke("clearTriageHistory", {});
      if (res.data?.success) {
        onCleared?.();
        setOpen(false);
      } else {
        alert(res.data?.error || "Erro ao limpar histórico");
      }
    } catch (err) {
      alert(err?.response?.data?.error || "Erro de conexão ao limpar histórico");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 text-[10px] font-semibold text-[#f87171] hover:text-white hover:bg-[#f87171]/20 transition-colors px-3 py-2 rounded-xl bg-[#f87171]/10 border border-[#f87171]/20 uppercase tracking-wider"
      >
        <Trash2 className="w-3.5 h-3.5" />
        Limpar histórico
      </button>

      <AlertDialogContent className="bg-[#121212] border-[#2d2d2d]">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-white">Apagar todo o histórico?</AlertDialogTitle>
          <AlertDialogDescription className="text-[#a0a0a0]">
            Todas as avaliações salvas serão removidas permanentemente. Esta ação não pode ser desfeita.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading} className="bg-transparent border-[#2d2d2d] text-[#a0a0a0] hover:bg-[#1a1a1a] hover:text-white">
            Cancelar
          </AlertDialogCancel>
          <button
            onClick={handleClear}
            disabled={loading}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-[#f87171] text-white hover:bg-[#ef4444] transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {loading ? "Apagando..." : "Apagar tudo"}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}