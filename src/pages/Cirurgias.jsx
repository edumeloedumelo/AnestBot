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
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-6 sm:py-10">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground font-heading tracking-wide">
            Gerenciar Cirurgias
          </h1>
        </div>

        <p className="text-sm text-muted-foreground mb-6 font-display italic tracking-wide opacity-70">
          Cadastre os tipos de cirurgia e defina quais exames são obrigatórios e os limites aceitáveis para cada um.
        </p>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-muted/50 rounded-2xl p-1.5 backdrop-blur-sm">
          <button
            onClick={() => setActiveTab("surgeries")}
            className={`flex-1 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 ${
              activeTab === "surgeries"
                ? "bg-background text-foreground shadow-lg shadow-black/10"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Settings className="w-3.5 h-3.5 inline mr-1.5" />
            Tipos de cirurgia
          </button>
          <button
            onClick={() => setActiveTab("limits")}
            className={`flex-1 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 ${
              activeTab === "limits"
                ? "bg-background text-foreground shadow-lg shadow-black/10"
                : "text-muted-foreground hover:text-foreground"
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
                className="mb-6 bg-primary hover:bg-primary/90 text-primary-foreground gap-2 rounded-2xl shadow-lg shadow-primary/10 transition-all duration-300"
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
                <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              </div>
            ) : surgeries.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">Nenhuma cirurgia cadastrada ainda.</p>
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
            <div className="mb-6 p-4 bg-card/80 backdrop-blur-sm border border-border/50 rounded-2xl shadow-sm">
              <p className="text-sm text-muted-foreground font-display italic opacity-80">
                Defina os valores de referência e regras de interpretação que a equipe considera aceitáveis para cada exame. Esses limites serão usados automaticamente na triagem.
              </p>
            </div>

            {!showLimitForm && (
              <Button
                onClick={() => { setEditingLimit(null); setShowLimitForm(true); }}
                className="mb-6 bg-primary hover:bg-primary/90 text-primary-foreground gap-2 rounded-2xl shadow-lg shadow-primary/10 transition-all duration-300"
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
                <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              </div>
            ) : examLimits.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">Nenhum limite de exame definido ainda.</p>
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