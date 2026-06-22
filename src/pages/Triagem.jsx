import { useState, useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RotateCcw, Upload, Share2, AlertTriangle } from "lucide-react";
import FileUploader from "@/components/triagem/FileUploader";
import ProgressIndicator from "@/components/triagem/ProgressIndicator";
import PainelResumo from "@/components/triagem/PainelResumo";
import SecurityNotice from "@/components/triagem/SecurityNotice";
import PullToRefresh from "@/components/PullToRefresh";

export default function Triagem() {
  const [anamnesis, setAnamnesis] = useState("");
  const [files, setFiles] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [progressStatus, setProgressStatus] = useState("");
  const [error, setError] = useState("");
  const [errorType, setErrorType] = useState(""); // '422' | 'generic'
  const [notFoundReason, setNotFoundReason] = useState("");
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
    setErrorType("");
    setNotFoundReason("");
    setResults(null);
  }, [files]);

  const handleAnalyze = async () => {
    if (!canAnalyze) return;

    const MAX_TOTAL_MB = 200;
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    if (totalSize > MAX_TOTAL_MB * 1024 * 1024) {
      setError(`Total de arquivos excede ${MAX_TOTAL_MB}MB. Reduza o tamanho ou divida em lotes menores.`);
      setErrorType("generic");
      return;
    }

    setAnalyzing(true);
    setError("");
    setErrorType("");
    setNotFoundReason("");
    setResults(null);

    try {
      setProgressStatus("uploading");
      const uploadResults = await Promise.all(
        files.map(file => base44.integrations.Core.UploadFile({ file }))
      );
      const fileUrls = uploadResults.map(r => r.file_url);
      setProgressStatus("analyzing");

      const response = await base44.functions.invoke("fastAnalyze", { fileUrls, anamnesis });

      // Handle 422 — surgery not identified
      if (response.status === 422 || response.data?.status === 422) {
        setError("Cirurgia não identificada");
        setErrorType("422");
        setNotFoundReason(response.data?.not_found_reason || "Não foi possível identificar a cirurgia na anamnese.");
        return;
      }

      if (response.data?.error) {
        const raw = response.data.error;
        setError(formatErrorMessage(raw));
        setErrorType("generic");
        return;
      }

      const resultData = response.data;
      if (!resultData || !resultData.patientName) {
        setError("Resposta inesperada do servidor. Tente novamente.");
        setErrorType("generic");
        return;
      }

      setResults(resultData);
      setProgressStatus("");
    } catch (err) {
      if (err?.response?.status === 422 || err?.response?.data?.status === 422) {
        setError("Cirurgia não identificada");
        setErrorType("422");
        setNotFoundReason(err?.response?.data?.not_found_reason || "Não foi possível identificar a cirurgia na anamnese.");
        return;
      }
      const raw = err?.response?.data?.error || err?.message || "Erro de conexão.";
      setError(formatErrorMessage(raw));
      setErrorType("generic");
    } finally {
      setAnalyzing(false);
    }
  };

  const formatErrorMessage = (raw) => {
    const msg = (raw || "").toLowerCase();
    if (msg.includes("user-exception") || msg.includes("limite") || msg.includes("tamanho") || msg.includes("grande")) {
      return "Arquivo muito grande ou formato incompatível. Reduza o tamanho do PDF (máx. 100MB por arquivo) e tente novamente.";
    }
    if (msg.includes("429") || msg.includes("rate")) {
      return "Muitas requisições. Aguarde alguns segundos e tente novamente.";
    }
    if (msg.includes("timeout")) {
      return "A análise excedeu o tempo limite. Tente com menos arquivos.";
    }
    return raw;
  };

  return (
    <PullToRefresh onRefresh={() => window.location.reload()}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        {/* Header */}
        <header className="mb-6 sm:mb-8">
          <h1 className="text-sm font-extrabold text-white tracking-[0.15em] uppercase">
            Avaliação Pré-Anestésica
          </h1>
          <p className="text-[10px] sm:text-[11px] text-[#a0a0a0] mt-0.5 hidden sm:block">
            Apoio à decisão clínica — Suporte Anestésico Pré-Cirúrgico
          </p>
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

        {/* Security Notice */}
        {!results && !analyzing && (
          <div className="mb-6">
            <SecurityNotice />
          </div>
        )}

        {/* Main content — before results */}
        {!results && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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
                  placeholder="Tipo de cirurgia, comorbidades, medicações, alergias, IMC, idade — quanto mais detalhes, melhor a análise..."
                  value={anamnesis}
                  onChange={(e) => setAnamnesis(e.target.value)}
                  disabled={analyzing}
                  rows={4}
                  className="bg-[#0a0a0a] border-[#2d2d2d] resize-none rounded-xl text-white placeholder:text-[#555] focus:border-[#555] transition-colors text-sm"
                />
                <p className="text-[10px] text-[#555] mt-3 uppercase tracking-wider">
                  Informe o tipo de cirurgia — essencial para a triagem correta
                </p>
              </div>

              {/* Error — 422 Surgery not found */}
              {error && errorType === "422" && (
                <div className="p-5 bg-[#1a1a00] border border-[#332200] rounded-2xl space-y-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-[#FFC107]" />
                    <p className="text-xs text-[#FFC107] font-bold uppercase tracking-wider">Cirurgia não identificada</p>
                  </div>
                  <p className="text-xs text-[#cccccc] leading-relaxed">{notFoundReason}</p>
                  <p className="text-[10px] text-[#888]">
                    Verifique as cirurgias cadastradas em{" "}
                    <Link to="/cirurgias" className="text-[#aaa] underline hover:text-white transition-colors">
                      Configurações
                    </Link>
                    {" "}ou ajuste a anamnese informando o nome exato.
                  </p>
                </div>
              )}

              {/* Error — generic */}
              {error && errorType === "generic" && (
                <div className="p-5 bg-[#1a0000] border border-[#4a2020] rounded-2xl space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-[#f87171]" />
                    <p className="text-xs text-[#f87171] font-bold uppercase tracking-wider">Erro na análise</p>
                  </div>
                  <p className="text-xs text-[#ff8888] leading-relaxed">{error}</p>
                </div>
              )}

              {/* Analyze button */}
              <Button
                onClick={handleAnalyze}
                disabled={!canAnalyze}
                className="w-full h-14 text-sm font-bold uppercase tracking-[0.2em] rounded-xl bg-[#808080] hover:bg-[#999] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {analyzing ? "Analisando..." : (
                  <><Upload className="w-5 h-5 mr-2" /> Analisar exames</>
                )}
              </Button>
            </div>

            {/* Sidebar — info */}
            <div className="lg:col-span-1">
              <div className="bg-[#121212] border border-[#2d2d2d] rounded-2xl p-5">
                <h3 className="text-[11px] font-bold text-white uppercase tracking-[0.15em] mb-1">
                  Arquivos
                </h3>
                <p className="text-[10px] text-[#555] uppercase tracking-wider mb-4">
                  {files.length > 0 ? `${files.length} arquivo${files.length > 1 ? 's' : ''} carregado${files.length > 1 ? 's' : ''}` : 'Nenhum exame carregado'}
                </p>
                <div className="space-y-3">
                  <p className="text-[11px] text-[#555] text-center py-8">
                    {files.length > 0
                      ? 'Todos os arquivos serão analisados como sendo da mesma paciente'
                      : 'Envie os exames e preencha a anamnese para análise'}
                  </p>
                </div>
                <div className="mt-4 pt-4 border-t border-[#1a1a1a]">
                  <p className="text-[10px] text-[#444] leading-relaxed">
                    Formatos aceitos: PDF, JPG, PNG, TXT — até 100MB por arquivo · HEIC: converta para JPG
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {analyzing && !results && <ProgressIndicator status={progressStatus} />}

        {/* Results — single patient */}
        {results && (
          <div className="space-y-6 max-w-3xl">
            <PainelResumo result={results} />

            <div className="flex justify-center pt-4 pb-12">
              <Button onClick={resetAll} variant="outline" className="gap-2 rounded-xl h-11 border-[#2d2d2d] text-[#a0a0a0] hover:text-white hover:border-[#555] bg-transparent transition-colors text-xs uppercase tracking-wider">
                <RotateCcw className="w-4 h-4" />
                Nova avaliação
              </Button>
            </div>
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
    </PullToRefresh>
  );
}