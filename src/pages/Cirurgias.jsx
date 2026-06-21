import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Plus, Settings, Trash2, Loader2 } from "lucide-react";
import SurgeryCard from "@/components/cirurgias/SurgeryCard";
import SurgeryForm from "@/components/cirurgias/SurgeryForm";
import ExamLimitCard from "@/components/cirurgias/ExamLimitCard";
import ExamLimitForm from "@/components/cirurgias/ExamLimitForm";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

export default function Cirurgias() {
  const [surgeries, setSurgeries] = useState([]);
  const [examLimits, setExamLimits] = useState([]);
  const [loadingSurgeries, setLoadingSurgeries] = useState(true);
  const [loadingLimits, setLoadingLimits] = useState(true);
  const [showSurgeryForm, setShowSurgeryForm] = useState(false);
  const [showLimitForm, setShowLimitForm] = useState(false);
  const [editingSurgery, setEditingSurgery] = useState(null);
  const [editingLimit, setEditingLimit] = useState(null);
  const [activeTab, setActiveTab] = useState("surgeries");
  const [surgeryError, setSurgeryError] = useState("");
  const [limitError, setLimitError] = useState("");
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  const loadSurgeries = async () => {
    const data = await base44.entities.Surgery.list();
    setSurgeries(data);
    setLoadingSurgeries(false);
  };

  const loadLimits = async () => {
    const data = await base44.entities.ExamLimit.list();
    setExamLimits(data);
    setLoadingLimits(false);
  };

  useEffect(() => { loadSurgeries(); loadLimits(); }, []);

  const handleSaveSurgery = async (data) => {
    setSurgeryError("");
    try {
      if (editingSurgery) {
        await base44.entities.Surgery.update(editingSurgery.id, data);
      } else {
        await base44.entities.Surgery.create(data);
      }
      setShowSurgeryForm(false);
      setEditingSurgery(null);
      loadSurgeries();
    } catch (err) {
      setSurgeryError(err?.message || "Erro ao salvar cirurgia.");
    }
  };

  const handleDeleteSurgery = async (surgery) => {
    setSurgeryError("");
    try {
      await base44.entities.Surgery.delete(surgery.id);
      loadSurgeries();
    } catch (err) {
      setSurgeryError(err?.message || "Erro ao excluir cirurgia.");
    }
  };

  const handleEditSurgery = (surgery) => {
    setSurgeryError("");
    setEditingSurgery(surgery);
    setShowSurgeryForm(true);
  };

  const handleSaveLimit = async (data) => {
    setLimitError("");
    try {
      if (editingLimit) {
        await base44.entities.ExamLimit.update(editingLimit.id, data);
      } else {
        await base44.entities.ExamLimit.create(data);
      }
      setShowLimitForm(false);
      setEditingLimit(null);
      loadLimits();
    } catch (err) {
      setLimitError(err?.message || "Erro ao salvar limite.");
    }
  };

  const handleDeleteLimit = async (limit) => {
    setLimitError("");
    try {
      await base44.entities.ExamLimit.delete(limit.id);
      loadLimits();
    } catch (err) {
      setLimitError(err?.message || "Erro ao excluir limite.");
    }
  };

  const handleEditLimit = (limit) => {
    setEditingLimit(limit);
    setShowLimitForm(true);
  };

  return (
    <div className="bg-background">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="mb-8">
          <div>
            <h1 className="text-sm font-extrabold text-white uppercase tracking-[0.15em]">
              Gerenciar Cirurgias
            </h1>
            <p className="text-[11px] text-[#555] mt-0.5">
              Cadastre tipos de cirurgia e defina exames obrigatórios e limites aceitáveis
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-[#0a0a0a] rounded-2xl p-1.5 border border-[#1a1a1a]">
          <button
            onClick={() => setActiveTab("surgeries")}
            className={`flex-1 px-4 py-2 rounded-xl text-[11px] font-semibold uppercase tracking-wider transition-colors ${
              activeTab === "surgeries"
                ? "bg-[#1a1a1a] text-white"
                : "text-[#555] hover:text-[#a0a0a0]"
            }`}
          >
            <Settings className="w-3.5 h-3.5 inline mr-1.5" />
            Tipos de cirurgia
          </button>
          <button
            onClick={() => setActiveTab("limits")}
            className={`flex-1 px-4 py-2 rounded-xl text-[11px] font-semibold uppercase tracking-wider transition-colors ${
              activeTab === "limits"
                ? "bg-[#1a1a1a] text-white"
                : "text-[#555] hover:text-[#a0a0a0]"
            }`}
          >
            <Plus className="w-3.5 h-3.5 inline mr-1.5" />
            Limites de exames
          </button>
        </div>

        {/* Surgeries Tab */}
        {activeTab === "surgeries" && (
          <>
            {!showSurgeryForm && (
              <Button
                onClick={() => { setEditingSurgery(null); setShowSurgeryForm(true); }}
                className="mb-6 bg-[#808080] hover:bg-[#999] text-white gap-2 rounded-xl text-xs font-semibold uppercase tracking-wider transition-colors"
              >
                <Plus className="w-4 h-4" /> Nova cirurgia
              </Button>
            )}

            {showSurgeryForm && (
              <div className="mb-6">
                <SurgeryForm surgery={editingSurgery} onSave={handleSaveSurgery} onCancel={() => { setShowSurgeryForm(false); setEditingSurgery(null); setSurgeryError(""); }} />
              </div>
            )}

            {surgeryError && (
              <div className="mb-4 p-3 bg-[#1a0000] border border-[#4a2020] rounded-xl">
                <p className="text-xs text-[#ff4444] font-medium uppercase tracking-wider">{surgeryError}</p>
              </div>
            )}

            {loadingSurgeries ? (
              <div className="flex justify-center py-12">
                <div className="w-5 h-5 border-2 border-[#333] border-t-[#808080] rounded-full animate-spin" />
              </div>
            ) : surgeries.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-[#555] text-sm">Nenhuma cirurgia cadastrada ainda.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {surgeries.map((s) => (
                  <SurgeryCard key={s.id} surgery={s} onEdit={handleEditSurgery} onDelete={handleDeleteSurgery} />
                ))}
              </div>
            )}
          </>
        )}

        {/* Limits Tab */}
        {activeTab === "limits" && (
          <>
            <div className="mb-6 p-4 bg-[#121212] border border-[#2d2d2d] rounded-2xl">
              <p className="text-[11px] text-[#a0a0a0]">
                Defina os valores de referência e regras de interpretação que a equipe considera aceitáveis para cada exame.
              </p>
            </div>

            {!showLimitForm && (
              <Button
                onClick={() => { setEditingLimit(null); setShowLimitForm(true); }}
                className="mb-6 bg-[#808080] hover:bg-[#999] text-white gap-2 rounded-xl text-xs font-semibold uppercase tracking-wider transition-colors"
              >
                <Plus className="w-4 h-4" /> Novo limite
              </Button>
            )}

            {showLimitForm && (
              <div className="mb-6">
                <ExamLimitForm limit={editingLimit} onSave={handleSaveLimit} onCancel={() => { setShowLimitForm(false); setEditingLimit(null); setLimitError(""); }} />
              </div>
            )}

            {limitError && (
              <div className="mb-4 p-3 bg-[#1a0000] border border-[#4a2020] rounded-xl">
                <p className="text-xs text-[#ff4444] font-medium uppercase tracking-wider">{limitError}</p>
              </div>
            )}

            {loadingLimits ? (
              <div className="flex justify-center py-12">
                <div className="w-5 h-5 border-2 border-[#333] border-t-[#808080] rounded-full animate-spin" />
              </div>
            ) : examLimits.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-[#555] text-sm">Nenhum limite de exame definido ainda.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {examLimits.map((l) => (
                  <ExamLimitCard key={l.id} limit={l} onEdit={handleEditLimit} onDelete={handleDeleteLimit} />
                ))}
              </div>
            )}
          </>
        )}

        {/* Delete Account */}
        <div className="mt-16 pt-8 border-t border-[#1a1a1a]">
          <div className="bg-[#f87171]/5 border border-[#f87171]/15 rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg bg-[#f87171]/10 flex items-center justify-center">
                <Trash2 className="w-4 h-4 text-[#f87171]" />
              </div>
              <div>
                <h3 className="text-xs font-extrabold text-white uppercase tracking-[0.15em]">Zona de Perigo</h3>
                <p className="text-[10px] text-[#888]">Excluir permanentemente sua conta e todos os dados</p>
              </div>
            </div>
            <Button
              onClick={() => setDeleteAccountOpen(true)}
              variant="destructive"
              className="bg-[#f87171] hover:bg-[#ef4444] text-white gap-2 rounded-xl text-xs font-semibold uppercase tracking-wider"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Excluir minha conta
            </Button>
          </div>
        </div>

        <AlertDialog open={deleteAccountOpen} onOpenChange={setDeleteAccountOpen}>
          <AlertDialogContent className="bg-[#121212] border-[#2d2d2d] max-w-sm">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-white text-base">Excluir sua conta?</AlertDialogTitle>
              <AlertDialogDescription className="text-[#a0a0a0] text-sm leading-relaxed">
                Esta ação é irreversível. Todos os seus dados, avaliações e configurações serão permanentemente removidos. Sua conta será encerrada e você perderá o acesso ao aplicativo.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deletingAccount} className="bg-transparent border-[#2d2d2d] text-[#a0a0a0] hover:bg-[#1a1a1a] hover:text-white text-xs uppercase tracking-wider">
                Cancelar
              </AlertDialogCancel>
              <button
                onClick={async () => {
                  setDeletingAccount(true);
                  try {
                    await base44.functions.invoke("clearTriageHistory", {});
                    await base44.auth.logout("/");
                  } catch {
                    await base44.auth.logout("/");
                  }
                }}
                disabled={deletingAccount}
                className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold bg-[#f87171] text-white hover:bg-[#ef4444] transition-colors disabled:opacity-50 uppercase tracking-wider"
              >
                {deletingAccount ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                {deletingAccount ? "Excluindo..." : "Sim, excluir tudo"}
              </button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}