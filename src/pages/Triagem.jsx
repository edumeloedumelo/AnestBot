import { useState, useCallback, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RotateCcw, Settings, ClipboardList, Upload, Share2, Activity, Zap, Bell, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import FileUploader from "@/components/triagem/FileUploader";
import ProgressIndicator from "@/components/triagem/ProgressIndicator";
import PainelResumo from "@/components/triagem/PainelResumo";
import ClearHistoryButton from "@/components/historico/ClearHistoryButton";

export default function Triagem() {
  const [anamnesis, setAnamnesis] = useState("");
  const [files, setFiles] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [progressStatus, setProgressStatus] = useState("");
  const [error, setError] = useState("");
  const [results, setResults] = useState(null);
  const [sharedReceived, setSharedReceived] = useState(false);
  const [streamMode, setStreamMode] = useState(true);
  const [streamingResult, setStreamingResult] = useState(null);
  const [whatsappResults, setWhatsappResults] = useState([]);
  const [newWhatsappCount, setNewWhatsappCount] = useState(0);

  // Subscribe to new Triage records (from WhatsApp webhook)
  useEffect(() => {
    let initialLoad = true;

    const loadRecent = async () => {
      try {
        const recent = await base44.entities.Triage.list('-created_date', 20);
        setWhatsappResults(recent);
        if (initialLoad) initialLoad = false;
      } catch {}
    };

    loadRecent();

    const unsubscribe = base44.entities.Triage.subscribe((event) => {
      try {
        if (event.type === 'create' && event.data) {
          setWhatsappResults(prev => [event.data, ...prev]);
          setNewWhatsappCount(c => c + 1);
        }
      } catch {}
    });

    return unsubscribe;
  }, []);

  const canAnalyze = files.length > 0 && !analyzing;

  useEffect(() => {
    const handler = (e) => {
      const { text, files: sharedFiles } = e.detail || {};
      if (sharedFiles && sharedFiles.length > 0) {
        const newFiles = sharedFiles.map((f) => {
          const blob = new Blob([new Uint8Array(f.data)], { type: f.type });
          return new File([blob], f.name, { type: f.type });
        });
        setFiles((prev) => [...prev, ...newFiles]);
        setSharedReceived(true);
        if (text && text.trim()) {
          setAnamnesis((prev) => prev ? prev + '\n' + text : text);
        }
      }
    };
    window.addEventListener('app:sharedFiles', handler);
    return () => window.removeEventListener('app:sharedFiles', handler);
  }, []);

  const resetAll = useCallback(() => {
    files.forEach((f) => {
      if (f.preview) URL.revokeObjectURL(f.preview);
    });
    setAnamnesis("");
    setFiles([]);
    setAnalyzing(false);
    setProgressStatus("");
    setError("");
    setResults(null);
    setStreamingResult(null);
  }, [files]);

  const handleAnalyze = async () => {
    if (!canAnalyze) return;

    // Check for very large files that may cause API errors
    const MAX_TOTAL_MB = 100;
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    if (totalSize > MAX_TOTAL_MB * 1024 * 1024) {
      setError(`Total de arquivos excede ${MAX_TOTAL_MB}MB. Reduza o tamanho ou divida em lotes menores.`);
      return;
    }

    setAnalyzing(true);
    setError("");
    setResults(null);
    setStreamingResult(null);

    try {
      setProgressStatus("uploading");
      const uploadResults = await Promise.all(
        files.map(file => base44.integrations.Core.UploadFile({ file }))
      );
      const fileUrls = uploadResults.map(r => r.file_url);
      setProgressStatus("");

      // Usa sempre o SDK para máxima confiabilidade
      setProgressStatus("analyzing");

      const fnName = streamMode ? "fastAnalyzeStream" : "fastAnalyze";
      const response = await base44.functions.invoke(fnName, { fileUrls, anamnesis });

      if (response.data?.error) {
        const raw = response.data.error;
        const msgLower = raw.toLowerCase();
        let msg;
        if (msgLower.includes("user-exception") || msgLower.includes("user exception")) {
          msg = "Arquivo muito grande ou formato incompatível. Reduza o tamanho do PDF (máx. 30MB) e tente novamente.";
        } else if (msgLower.includes("limite") || msgLower.includes("tamanho") || msgLower.includes("grande")) {
          msg = raw;
        } else if (msgLower.includes("429") || msgLower.includes("rate")) {
          msg = "Muitas requisições. Aguarde alguns segundos e tente novamente.";
        } else if (msgLower.includes("401") || msgLower.includes("unauthorized")) {
          msg = "Erro de autenticação com o serviço de IA.";
        } else if (msgLower.includes("timeout")) {
          msg = "A análise excedeu o tempo limite. Tente com menos arquivos.";
        } else {
          msg = raw;
        }
        setError(msg);
        return;
      }

      // Multi-paciente: results é um array de análises
      const analysisResults = response.data?.results || [];
      if (analysisResults.length === 0) {
        setResults([]);
        return;
      }

      setResults(analysisResults.map(r => ({
        patientName: r.patientName || '',
        patientInfo: r.patientInfo || '',
        surgeryType: r.surgeryType || '',
        examResults: r.examResults || [],
        alerts: r.alerts || [],
        missingExams: r.missingExams || [],
        alteredExams: r.alteredExams || [],
        finalStatus: r.finalStatus || '',
        conduct: r.conduct || '',
        blocoResumo: r.blocoResumo || '',
        relatorioTecnico: r.relatorioTecnico || '',
        medicationsToSuspend: r.medicationsToSuspend || []
      })));
      setStreamingResult(null);
      setProgressStatus("");
    } catch (err) {
      const raw = err?.response?.data?.error || err?.message || "Erro de conexão.";
      const msgLower = raw.toLowerCase();
      let msg;
      if (msgLower.includes("user-exception") || msgLower.includes("user exception")) {
        msg = "Arquivo muito grande ou formato incompatível. Reduza o tamanho do PDF (máx. 30MB) e tente novamente.";
      } else if (msgLower.includes("limite") || msgLower.includes("tamanho") || msgLower.includes("grande")) {
        msg = raw;
      } else if (msgLower.includes("429") || msgLower.includes("rate")) {
        msg = "Muitas requisições. Aguarde alguns segundos e tente novamente.";
      } else if (msgLower.includes("401") || msgLower.includes("unauthorized")) {
        msg = "Erro de autenticação com o serviço de IA. Contate o administrador.";
      } else if (msgLower.includes("500") || msgLower.includes("internal")) {
        msg = "Erro no servidor. Tente novamente em alguns instantes.";
      } else if (msgLower.includes("timeout")) {
        msg = "A análise excedeu o tempo limite. Tente com menos arquivos ou arquivos menores.";
      } else {
        msg = raw;
      }
      setError(msg);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#000000]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Header */}
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8 sm:mb-10">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="w-9 h-9 rounded-xl bg-[#121212] border border-[#2d2d2d] flex items-center justify-center flex-shrink-0">
              <Activity className="w-5 h-5 text-[#808080]" />
            </div>
            <div>
              <h1 className="text-sm font-extrabold text-white tracking-[0.15em] uppercase">
                Avaliação Pré-Anestésica
              </h1>
              <p className="text-[10px] sm:text-[11px] text-[#a0a0a0] mt-0.5 hidden sm:block">
                Apoio à decisão clínica — Suporte Anestésico Pré-Cirúrgico
              </p>
            </div>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <Link
              to="/cirurgias"
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 text-[11px] font-medium text-[#a0a0a0] hover:text-white transition-colors px-3 py-2.5 rounded-full bg-[#121212] border border-[#2d2d2d] uppercase tracking-wider"
            >
              <Settings className="w-3.5 h-3.5" />
              <span className="sm:inline">Configurações</span>
            </Link>
            <Link
              to="/historico"
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 text-[11px] font-medium text-[#a0a0a0] hover:text-white transition-colors px-3 py-2.5 rounded-full bg-[#121212] border border-[#2d2d2d] uppercase tracking-wider"
            >
              <ClipboardList className="w-3.5 h-3.5" />
              <span className="sm:inline">Histórico</span>
            </Link>
          </div>
        </header>

        {/* Shared indicator */}
        {sharedReceived && !analyzing && !results && !streamingResult && (
          <div className="mb-6 p-4 bg-[#121212] border border-[#2d2d2d] rounded-2xl flex items-center gap-3">
            <Share2 className="w-4 h-4 text-[#808080]" />
            <div>
              <p className="text-xs font-medium text-white uppercase tracking-wider">Arquivos recebidos via WhatsApp</p>
              <p className="text-[11px] text-[#a0a0a0]">Pronto para análise</p>
            </div>
          </div>
        )}

        {/* Two-column layout */}
        {!results && !streamingResult && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main column */}
            <div className="lg:col-span-2 space-y-6">
              {/* Upload card */}
              <div className="bg-[#121212] border border-[#2d2d2d] rounded-2xl p-6">
                <FileUploader files={files} setFiles={setFiles} disabled={analyzing} />
              </div>

              {/* Anamnese */}
              <div className="bg-[#121212] border border-[#2d2d2d] rounded-2xl p-6">
                <Label htmlFor="anamnesis" className="text-[11px] font-semibold text-white uppercase tracking-[0.15em] block mb-4">
                  Anamnese / Observações clínicas
                </Label>
                <Textarea
                  id="anamnesis"
                  placeholder="Comorbidades, histórico cirúrgico, medicações de uso contínuo, alergias, IMC, idade..."
                  value={anamnesis}
                  onChange={(e) => setAnamnesis(e.target.value)}
                  disabled={analyzing}
                  rows={3}
                  className="bg-[#0a0a0a] border-[#2d2d2d] resize-none rounded-xl text-white placeholder:text-[#555] focus:border-[#555] transition-colors text-sm"
                />
                <p className="text-[10px] text-[#555] mt-3 uppercase tracking-wider">
                  Opcional · Aplicado a todos os pacientes do lote
                </p>
              </div>

              {/* Error */}
              {error && (
                <div className="p-5 bg-[#1a0000] border border-[#4a2020] rounded-2xl space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-[#f87171]" />
                    <p className="text-xs text-[#f87171] font-bold uppercase tracking-wider">Erro na análise</p>
                  </div>
                  <p className="text-xs text-[#ff8888] leading-relaxed">{error}</p>
                </div>
              )}

              {/* Mode toggle + Analyze button */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setStreamMode(!streamMode)}
                  disabled={analyzing}
                  className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider px-3 py-3.5 rounded-xl border transition-all flex-shrink-0
                    ${streamMode
                      ? 'bg-[#FFC107]/15 border-[#FFC107]/40 text-[#FFC107] shadow-[0_0_12px_rgba(255,193,7,0.08)]'
                      : 'bg-[#121212] border-[#2d2d2d] text-[#555] hover:border-[#555] hover:text-[#808080]'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <Zap className={`w-3.5 h-3.5 ${streamMode ? 'text-[#FFC107]' : ''}`} />
                  <span className="hidden sm:inline">{streamMode ? 'Turbo ativo' : 'Turbo'}</span>
                </button>
                <Button
                  onClick={handleAnalyze}
                  disabled={!canAnalyze}
                  className={`flex-1 h-14 text-sm font-bold uppercase tracking-[0.2em] rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                    ${streamMode ? 'bg-[#FFC107] hover:bg-[#FFD54F] text-black' : 'bg-[#808080] hover:bg-[#999]'}`}
                >
                  {analyzing ? "Analisando..." : (
                    <><Upload className="w-5 h-5 mr-2" /> Analisar exames</>
                  )}
                </Button>
              </div>
            </div>

            {/* Sidebar — Pacientes */}
            <div className="lg:col-span-1">
              <div className="bg-[#121212] border border-[#2d2d2d] rounded-2xl p-5">
                <h3 className="text-[11px] font-bold text-white uppercase tracking-[0.15em] mb-1">
                  Pacientes
                </h3>
                <p className="text-[10px] text-[#555] uppercase tracking-wider mb-4">
                  {files.length > 0 ? `${files.length} arquivo${files.length > 1 ? 's' : ''} carregado${files.length > 1 ? 's' : ''}` : 'Nenhum exame carregado'}
                </p>
                <div className="space-y-3">
                  <p className="text-[11px] text-[#555] text-center py-8">
                    {files.length > 0
                      ? 'A IA identifica automaticamente cada paciente pelo nome nos exames'
                      : 'Envie arquivos para identificar pacientes automaticamente'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Streaming partial result */}
        {streamingResult && (
          <div className="space-y-6 max-w-3xl">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#FFC107] animate-pulse" />
              <p className="text-[10px] text-[#FFC107] font-semibold uppercase tracking-[0.2em]">
                Processando em tempo real...
              </p>
            </div>
            <PainelResumo result={streamingResult} />
          </div>
        )}

        {analyzing && !streamingResult && !results && <ProgressIndicator status={progressStatus} />}

        {/* Results */}
        {results && results.length > 0 && (
          <div className="space-y-6 max-w-3xl">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-[#808080] font-semibold uppercase tracking-[0.2em]">
                {results.length} paciente{results.length > 1 ? "s" : ""} encontrado{results.length > 1 ? "s" : ""}
              </p>
            </div>

            {results.map((result, i) => (
              <PainelResumo key={i} result={result} />
            ))}

            <div className="flex justify-center pt-4 pb-12">
              <Button onClick={resetAll} variant="outline" className="gap-2 rounded-xl h-11 border-[#2d2d2d] text-[#a0a0a0] hover:text-white hover:border-[#555] bg-transparent transition-colors text-xs uppercase tracking-wider">
                <RotateCcw className="w-4 h-4" />
                Nova avaliação
              </Button>
            </div>
          </div>
        )}

        {results && results.length === 0 && (
          <div className="text-center py-20">
            <p className="text-[#a0a0a0] mb-6 text-sm">
              Nenhum paciente identificado nos arquivos enviados.
            </p>
            <Button onClick={resetAll} variant="outline" className="gap-2 rounded-xl border-[#2d2d2d] text-[#a0a0a0] hover:text-white bg-transparent text-xs uppercase tracking-wider">
              <RotateCcw className="w-4 h-4" />
              Tentar novamente
            </Button>
          </div>
        )}

        {/* WhatsApp Results */}
        {whatsappResults.length > 0 && !results && (
          <div className="space-y-6 max-w-3xl mt-10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-[#25D366]/10 border border-[#25D366]/20 flex items-center justify-center">
                  <Bell className="w-4 h-4 text-[#25D366]" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white uppercase tracking-[0.1em]">
                    Análises via WhatsApp
                  </p>
                  <p className="text-[10px] text-[#555] uppercase tracking-wider">
                    {whatsappResults.length} registro{whatsappResults.length > 1 ? 's' : ''} recebido{whatsappResults.length > 1 ? 's' : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {newWhatsappCount > 0 && (
                  <span className="px-3 py-1 rounded-full bg-[#25D366]/15 text-[#25D366] text-[10px] font-bold uppercase tracking-wider animate-pulse">
                    {newWhatsappCount} novo{newWhatsappCount > 1 ? 's' : ''}
                  </span>
                )}
                <ClearHistoryButton onCleared={() => { setWhatsappResults([]); setNewWhatsappCount(0); }} />
              </div>
            </div>

            {whatsappResults.map((triage, i) => (
              <PainelResumo
                key={triage.id || i}
                result={{
                  patientName: triage.patient_name,
                  surgeryType: triage.surgery_type,
                  examResults: [],
                  alerts: triage.altered_exams?.length ? triage.altered_exams.map(e => ({
                    severity: '⚠️',
                    text: `${e} — alterado`
                  })) : [],
                  finalStatus: triage.status === 'complete_without_alerts' ? '✅ Completo sem alertas' :
                               triage.status === 'complete_with_alerts' ? '⚠️ Completo com alertas' :
                               triage.status === 'incomplete' ? '❌ Exames pendentes' : '🚨 Pendência crítica',
                  conduct: triage.status === 'complete_without_alerts' ? '✅ Paciente apta para cirurgia. Prosseguir conforme protocolo.' :
                           triage.status === 'complete_with_alerts' ? '⚠️ Paciente requer avaliação adicional.' :
                           triage.status === 'incomplete' ? '❌ Exames obrigatórios faltantes. Solicitar antes da avaliação.' : '🚨 Pendência crítica — não liberar sem resolução.',
                  blocoResumo: triage.bloco_resumo || '',
                  relatorioTecnico: triage.relatorio_tecnico || '',
                  missingExams: triage.missing_exams || [],
                  alteredExams: triage.altered_exams || [],
                  medicationsToSuspend: []
                }}
              />
            ))}
          </div>
        )}

        {/* Footer */}
        <footer className="mt-20 pt-8 border-t border-[#1a1a1a] flex flex-col sm:flex-row items-center justify-between gap-4 text-[10px] text-[#555] uppercase tracking-wider">
          <p>© 2026 — Todos os direitos reservados</p>
          <div className="flex gap-6">
            <span>Termos</span>
            <span>Contato</span>
          </div>
        </footer>
      </div>
    </div>
  );
}