import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { ArrowLeft, Clock, AlertTriangle, CheckCircle, XCircle, Users, ClipboardList, Loader2, Trash2 } from "lucide-react";
import ClearHistoryButton from "@/components/historico/ClearHistoryButton";

const STATUS_CONFIG = {
  complete_without_alerts: { label: "Completo", icon: CheckCircle, color: "text-[#4ade80]", bg: "bg-[#4ade80]/10", border: "border-[#4ade80]/20" },
  complete_with_alerts: { label: "Com alertas", icon: AlertTriangle, color: "text-[#facc15]", bg: "bg-[#facc15]/10", border: "border-[#facc15]/20" },
  incomplete: { label: "Pendente", icon: XCircle, color: "text-[#fb923c]", bg: "bg-[#fb923c]/10", border: "border-[#fb923c]/20" },
  critical_pending: { label: "Crítico", icon: AlertTriangle, color: "text-[#f87171]", bg: "bg-[#f87171]/10", border: "border-[#f87171]/20" },
};

export default function Historico() {
  const [triages, setTriages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    loadTriages();
  }, []);

  const loadTriages = async () => {
    const data = await base44.entities.Triage.list("-created_date", 200);
    setTriages(data);
    setLoading(false);
  };

  const handleDelete = async (id) => {
    await base44.entities.Triage.delete(id);
    setTriages(prev => prev.filter(t => t.id !== id));
  };

  const filtered = filter === "all" ? triages : triages.filter(t => {
    if (filter === "pending") return t.status === "incomplete" || t.status === "critical_pending";
    if (filter === "critical") return t.status === "critical_pending";
    return t.status === filter;
  });

  const stats = {
    total: triages.length,
    pending: triages.filter(t => t.status === "incomplete" || t.status === "critical_pending").length,
    critical: triages.filter(t => t.status === "critical_pending").length,
    complete: triages.filter(t => t.status === "complete_without_alerts" || t.status === "complete_with_alerts").length,
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#000000] flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-[#808080] animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#000000]">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Link to="/" className="text-[#555] hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-sm font-extrabold text-white uppercase tracking-[0.15em]">Histórico de Avaliações</h1>
            <p className="text-[11px] text-[#555] mt-0.5">Painel administrativo — auditoria e rastreabilidade</p>
          </div>
          {triages.length > 0 && (
            <div className="ml-auto">
              <ClearHistoryButton onCleared={() => setTriages([])} />
            </div>
          )}
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: "Total", value: stats.total, icon: ClipboardList, color: "text-[#60a5fa]", bg: "bg-[#60a5fa]/10" },
            { label: "Concluídas", value: stats.complete, icon: CheckCircle, color: "text-[#4ade80]", bg: "bg-[#4ade80]/10" },
            { label: "Pendentes", value: stats.pending, icon: Clock, color: "text-[#fb923c]", bg: "bg-[#fb923c]/10" },
            { label: "Críticas", value: stats.critical, icon: AlertTriangle, color: "text-[#f87171]", bg: "bg-[#f87171]/10" },
          ].map((s) => (
            <div key={s.label} className={`${s.bg} border border-[#2d2d2d] rounded-2xl p-4 bg-[#121212]`}>
              <div className="flex items-center gap-2 mb-2">
                <s.icon className={`w-4 h-4 ${s.color}`} />
                <span className="text-[10px] text-[#a0a0a0] uppercase tracking-wider">{s.label}</span>
              </div>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          {[
            { key: "all", label: "Todas" },
            { key: "pending", label: "Pendentes" },
            { key: "critical", label: "Críticas" },
            { key: "complete_without_alerts", label: "Sem alertas" },
            { key: "complete_with_alerts", label: "Com alertas" },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-xl text-[10px] font-semibold whitespace-nowrap uppercase tracking-wider transition-colors ${
                filter === f.key
                  ? "bg-[#808080] text-white"
                  : "bg-[#121212] text-[#555] hover:text-white border border-[#2d2d2d]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Triages List */}
        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <Users className="w-10 h-10 text-[#333] mx-auto mb-3" />
            <p className="text-[#555] text-sm">Nenhuma avaliação encontrada.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((t) => {
              const config = STATUS_CONFIG[t.status] || STATUS_CONFIG.incomplete;
              const Icon = config.icon;
              const isExpanded = expanded === t.id;
              return (
                <div key={t.id} className={`bg-[#121212] border ${config.border} rounded-2xl overflow-hidden transition-colors`}>
                  <button
                    onClick={() => setExpanded(isExpanded ? null : t.id)}
                    className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-[#1a1a1a] transition-colors"
                  >
                    <div className={`w-8 h-8 rounded-full ${config.bg} flex items-center justify-center flex-shrink-0`}>
                      <Icon className={`w-4 h-4 ${config.color}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-sm text-white truncate uppercase tracking-wider">{t.patient_name}</h3>
                      <p className="text-[11px] text-[#a0a0a0]">{t.surgery_type}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="flex flex-col items-end gap-1">
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider ${config.bg} ${config.color}`}>
                          {config.label}
                        </span>
                        <span className="text-[10px] text-[#555]">
                          {new Date(t.created_date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(t.id); }}
                        className="p-2 rounded-lg text-[#555] hover:text-[#f87171] hover:bg-[#f87171]/10 transition-colors"
                        title="Excluir"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-[#1a1a1a]">
                      <div className="pt-3">
                        <h4 className="text-[10px] font-semibold text-[#808080] uppercase tracking-wider mb-2">Resumo para WhatsApp</h4>
                        <pre className="text-xs text-[#a0a0a0] whitespace-pre-wrap font-body leading-relaxed bg-[#0a0a0a] rounded-xl p-3">
                          {t.bloco_resumo || "Resumo não disponível."}
                        </pre>
                      </div>
                      <details className="mt-3">
                        <summary className="text-[10px] text-[#555] cursor-pointer hover:text-white uppercase tracking-wider">Ver relatório técnico completo</summary>
                        <pre className="text-[11px] text-[#a0a0a0] whitespace-pre-wrap font-mono leading-relaxed bg-[#0a0a0a] rounded-xl p-3 mt-2 max-h-64 overflow-auto">
                          {t.relatorio_tecnico || "Relatório não disponível."}
                        </pre>
                      </details>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}