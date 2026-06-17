import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Plus, ArrowLeft, Settings } from "lucide-react";
import { Link } from "react-router-dom";
import SurgeryCard from "@/components/cirurgias/SurgeryCard";
import SurgeryForm from "@/components/cirurgias/SurgeryForm";
import ExamLimitCard from "@/components/cirurgias/ExamLimitCard";
import ExamLimitForm from "@/components/cirurgias/ExamLimitForm";

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
    if (editingSurgery) {
      await base44.entities.Surgery.update(editingSurgery.id, data);
    } else {
      await base44.entities.Surgery.create(data);
    }
    setShowSurgeryForm(false);
    setEditingSurgery(null);
    loadSurgeries();
  };

  const handleDeleteSurgery = async (surgery) => {
    await base44.entities.Surgery.delete(surgery.id);
    loadSurgeries();
  };

  const handleEditSurgery = (surgery) => {
    setEditingSurgery(surgery);
    setShowSurgeryForm(true);
  };

  const handleSaveLimit = async (data) => {
    if (editingLimit) {
      await base44.entities.ExamLimit.update(editingLimit.id, data);
    } else {
      await base44.entities.ExamLimit.create(data);
    }
    setShowLimitForm(false);
    setEditingLimit(null);
    loadLimits();
  };

  const handleDeleteLimit = async (limit) => {
    await base44.entities.ExamLimit.delete(limit.id);
    loadLimits();
  };

  const handleEditLimit = (limit) => {
    setEditingLimit(limit);
    setShowLimitForm(true);
  };

  return (
    <div className="min-h-screen bg-[#000000]">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-8">
          <Link to="/" className="text-[#555] hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
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
                <SurgeryForm surgery={editingSurgery} onSave={handleSaveSurgery} onCancel={() => { setShowSurgeryForm(false); setEditingSurgery(null); }} />
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
                <ExamLimitForm limit={editingLimit} onSave={handleSaveLimit} onCancel={() => { setShowLimitForm(false); setEditingLimit(null); }} />
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
      </div>
    </div>
  );
}