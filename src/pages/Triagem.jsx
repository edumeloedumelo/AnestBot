import { useState, useCallback, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RotateCcw, Settings, ClipboardList, Upload, ArrowRight, Share2, Activity } from "lucide-react";
import { Link } from "react-router-dom";
import FileUploader from "@/components/triagem/FileUploader";
import ProgressIndicator from "@/components/triagem/ProgressIndicator";
import RelatorioTecnico from "@/components/triagem/RelatorioTecnico";
import BlocoResumo from "@/components/triagem/BlocoResumo";

export default function Triagem() {
  const [anamnesis, setAnamnesis] = useState("");
  const [files, setFiles] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [progressStatus, setProgressStatus] = useState("");
  const [error, setError] = useState("");
  const [results, setResults] = useState(null);
  const [sharedReceived, setSharedReceived] = useState(false);

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
  }, [files]);

  const handleAnalyze = async () => {
    if (!canAnalyze) return;
    setAnalyzing(true);
    setError("");
    setResults(null);
    try {
      setProgressStatus("uploading");
      // Upload em paralelo — todos os arquivos sobem simultaneamente
      const uploadPromises = files.map(file => base44.integrations.Core.UploadFile({ file }));
      const uploadResults = await Promise.all(uploadPromises);
      const fileUrls = uploadResults.map(r => r.file_url);
      setProgressStatus("analyzing");
      const response = await base44.functions.invoke("analyzeBatch", {
        fileUrls,
        anamnesis
      });
      if (response.data?.error) {
        setError(response.data.error);
        return;
      }
      setResults(response.data.results || []);
      setProgressStatus("");
    } catch (err) {
      setError("Erro de conexão. Verifique sua internet e tente novamente.");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#000000]">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <header className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-4">
            <div className="w-9 h-9 rounded-xl bg-[#121212] border border-[#2d2d2d] flex items-center justify-center">
              <Activity className="w-5 h-5 text-[#808080]" />
            </div>
            <div>
              <h1 className="text-sm font-extrabold text-white tracking-[0.15em] uppercase">
                Avaliação Pré-Anestésica
              </h1>
              <p className="text-[11px] text-[#a0a0a0] mt-0.5">
                Apoio à decisão clínica — Suporte Anestésico Pré-Cirúrgico
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Link
              to="/cirurgias"
              className="flex items-center gap-2 text-[11px] font-medium text-[#a0a0a0] hover:text-white transition-colors px-4 py-2 rounded-full bg-[#121212] border border-[#2d2d2d] uppercase tracking-wider"
            >
              <Settings className="w-3.5 h-3.5" />
              Configurações
            </Link>
            <Link
              to="/historico"
              className="flex items-center gap-2 text-[11px] font-medium text-[#a0a0a0] hover:text-white transition-colors px-4 py-2 rounded-full bg-[#121212] border border-[#2d2d2d] uppercase tracking-wider"
            >
              <ClipboardList className="w-3.5 h-3.5" />
              Histórico
            </Link>
          </div>
        </header>

        {/* Shared indicator */}
        {sharedReceived && !analyzing && !results && (
          <div className="mb-6 p-4 bg-[#121212] border border-[#2d2d2d] rounded-2xl flex items-center gap-3">
            <Share2 className="w-4 h-4 text-[#808080]" />
            <div>
              <p className="text-xs font-medium text-white uppercase tracking-wider">Arquivos recebidos via WhatsApp</p>
              <p className="text-[11px] text-[#a0a0a0]">Pronto para análise</p>
            </div>
          </div>
        )}

        {/* Two-column layout */}
        {!results && (
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
                <div className="p-4 bg-[#1a0000] border border-[#4a2020] rounded-2xl">
                  <p className="text-xs text-[#ff4444] font-medium uppercase tracking-wider">{error}</p>
                </div>
              )}

              {/* Analyze button */}
              <Button
                onClick={handleAnalyze}
                disabled={!canAnalyze}
                className="w-full bg-[#808080] hover:bg-[#999] text-white h-12 text-xs font-bold uppercase tracking-[0.2em] rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {analyzing ? "Analisando..." : (
                  <><Upload className="w-4 h-4 mr-2" /> Analisar exames <ArrowRight className="w-4 h-4 ml-2" /></>
                )}
              </Button>
            </div>

            {/* Sidebar — Pacientes */}
            <div className="lg:col-span-1">
              <div className="bg-[#121212] border border-[#2d2d2d] rounded-2xl p-5">
                <h3 className="text-[11px] font-bold text-white uppercase tracking-[0.15em] mb-1">
                  Pacientes
                </h3>
                <p className="text-[10px] text-[#555] uppercase tracking-wider mb-4">
                  Nenhum exame carregado
                </p>
                <div className="space-y-3">
                  <p className="text-[11px] text-[#555] text-center py-8">
                    Envie arquivos para identificar pacientes automaticamente
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {analyzing && <ProgressIndicator status={progressStatus} />}

        {/* Results */}
        {results && results.length > 0 && (
          <div className="space-y-6 max-w-3xl">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-[#808080] font-semibold uppercase tracking-[0.2em]">
                {results.length} paciente{results.length > 1 ? "s" : ""} encontrado{results.length > 1 ? "s" : ""}
              </p>
            </div>

            {results.map((result, i) => (
              <div key={i} className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#121212] border border-[#2d2d2d] flex items-center justify-center text-xs font-bold text-[#808080]">
                    {i + 1}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">{result.patientName}</h3>
                    <p className="text-[11px] text-[#a0a0a0]">{result.surgeryType}</p>
                  </div>
                </div>

                <BlocoResumo content={result.blocoResumo} patientName={result.patientName} />
                <RelatorioTecnico content={result.relatorioTecnico} patientName={result.patientName} />
              </div>
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