import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { ArrowLeft, Clock, AlertTriangle, CheckCircle, XCircle, Users, ClipboardList, Loader2 } from "lucide-react";

const STATUS_CONFIG = {
  complete_without_alerts: { label: "Completo", icon: CheckCircle, color: "text-green-400", bg: "bg-green-400/10", border: "border-green-400/30" },
  complete_with_alerts: { label: "Com alertas", icon: AlertTriangle, color: "text-yellow-400", bg: "bg-yellow-400/10", border: "border-yellow-400/30" },
  incomplete: { label: "Pendente", icon: XCircle, color: "text-orange-400", bg: "bg-orange-400/10", border: "border-orange-400/30" },
  critical_pending: { label: "Crítico", icon: AlertTriangle, color: "text-red-400", bg: "bg-red-400/10", border: "border-red-400/30" },
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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">Histórico de Avaliações</h1>
            <p className="text-sm text-muted-foreground">Painel administrativo — auditoria e rastreabilidade</p>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: "Total", value: stats.total, icon: ClipboardList, color: "text-blue-400", bg: "bg-blue-400/10" },
            { label: "Concluídas", value: stats.complete, icon: CheckCircle, color: "text-green-400", bg: "bg-green-400/10" },
            { label: "Pendentes", value: stats.pending, icon: Clock, color: "text-orange-400", bg: "bg-orange-400/10" },
            { label: "Críticas", value: stats.critical, icon: AlertTriangle, color: "text-red-400", bg: "bg-red-400/10" },
          ].map((s) => (
            <div key={s.label} className={`${s.bg} border border-border rounded-xl p-4`}>
              <div className="flex items-center gap-2 mb-2">
                <s.icon className={`w-4 h-4 ${s.color}`} />
                <span className="text-xs text-muted-foreground">{s.label}</span>
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
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                filter === f.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Triages List */}
        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <Users className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">Nenhuma avaliação encontrada.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((t) => {
              const config = STATUS_CONFIG[t.status] || STATUS_CONFIG.incomplete;
              const Icon = config.icon;
              const isExpanded = expanded === t.id;
              return (
                <div key={t.id} className={`bg-card border ${config.border} rounded-xl overflow-hidden`}>
                  <button
                    onClick={() => setExpanded(isExpanded ? null : t.id)}
                    className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-muted/30 transition-colors"
                  >
                    <div className={`w-8 h-8 rounded-full ${config.bg} flex items-center justify-center flex-shrink-0`}>
                      <Icon className={`w-4 h-4 ${config.color}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium text-sm text-foreground truncate">{t.patient_name}</h3>
                      <p className="text-xs text-muted-foreground">{t.surgery_type}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${config.bg} ${config.color}`}>
                        {config.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground/60">
                        {new Date(t.created_date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-border">
                      <div className="pt-3">
                        <h4 className="text-xs font-medium text-muted-foreground mb-2">Resumo para WhatsApp</h4>
                        <pre className="text-sm text-foreground/80 whitespace-pre-wrap font-sans leading-relaxed bg-muted/50 rounded-lg p-3">
                          {t.bloco_resumo || "Resumo não disponível."}
                        </pre>
                      </div>
                      <details className="mt-3">
                        <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">Ver relatório técnico completo</summary>
                        <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed bg-muted/50 rounded-lg p-3 mt-2 max-h-64 overflow-auto">
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