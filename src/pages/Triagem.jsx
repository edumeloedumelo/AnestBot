import { useState, useCallback, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RotateCcw, Settings, ClipboardList, Upload, ArrowRight, Share2 } from "lucide-react";
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

  // Listen for shared files from WhatsApp
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

        // If text was shared (anamnesis), set it
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

    setProgressStatus("uploading");
    const fileUrls = [];
    for (const file of files) {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      fileUrls.push(file_url);
    }

    setProgressStatus("analyzing");
    const response = await base44.functions.invoke("analyzeBatch", {
      fileUrls,
      anamnesis,
    });

    if (response.data?.error) {
      setError(response.data.error);
      setAnalyzing(false);
      return;
    }

    setResults(response.data.results || []);
    setAnalyzing(false);
    setProgressStatus("");
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-6 sm:py-10">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
            Avaliação Pré-Anestésica
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            Apoio à decisão clínica — Suporte Anestésico Pré-Cirúrgico
          </p>
        </div>

        {/* Admin links */}
        <div className="flex gap-2 mb-6">
          <Link
            to="/cirurgias"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-2 rounded-xl bg-card border border-border hover:border-primary/30"
          >
            <Settings className="w-3.5 h-3.5" />
            Configurações
          </Link>
          <Link
            to="/historico"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-2 rounded-xl bg-card border border-border hover:border-primary/30"
          >
            <ClipboardList className="w-3.5 h-3.5" />
            Histórico
          </Link>
        </div>

        {/* Shared indicator */}
        {sharedReceived && !analyzing && !results && (
          <div className="mb-4 p-3 bg-foreground/5 border border-foreground/20 rounded-xl flex items-center gap-3">
            <Share2 className="w-4 h-4 text-foreground/60 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Arquivos recebidos via WhatsApp</p>
              <p className="text-xs text-muted-foreground">Pronto para análise</p>
            </div>
          </div>
        )}

        {/* Form Card */}
        {!results && (
          <div className="bg-card rounded-2xl border border-border shadow-sm p-5 sm:p-6 mb-6">
            <div className="space-y-5">
              <FileUploader
                files={files}
                setFiles={setFiles}
                disabled={analyzing}
              />

              <div className="space-y-2">
                <Label htmlFor="anamnesis" className="text-sm font-medium text-foreground/80">
                  Anamnese / Observações clínicas
                </Label>
                <Textarea
                  id="anamnesis"
                  placeholder="Comorbidades, histórico cirúrgico, medicações de uso contínuo, alergias, IMC, idade..."
                  value={anamnesis}
                  onChange={(e) => setAnamnesis(e.target.value)}
                  disabled={analyzing}
                  rows={3}
                  className="bg-background border-border resize-none rounded-xl"
                />
                <p className="text-[11px] text-muted-foreground/60">
                  Opcional · Aplicado a todos os pacientes do lote
                </p>
              </div>
            </div>

            {error && (
              <div className="mt-4 p-3 bg-destructive/10 border border-destructive/30 rounded-xl">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <div className="mt-6">
              <Button
                onClick={handleAnalyze}
                disabled={!canAnalyze}
                className="w-full bg-foreground hover:bg-foreground/90 text-background px-8 h-12 text-sm font-semibold rounded-xl"
              >
                <Upload className="w-4 h-4 mr-2" />
                {analyzing ? "Analisando..." : "Analisar exames"}
                {!analyzing && <ArrowRight className="w-4 h-4 ml-1" />}
              </Button>
            </div>
          </div>
        )}

        {analyzing && <ProgressIndicator status={progressStatus} />}

        {/* Results */}
        {results && results.length > 0 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {results.length} paciente{results.length > 1 ? "s" : ""} encontrado{results.length > 1 ? "s" : ""}
              </p>
            </div>

            {results.map((result, i) => (
              <div key={i} className="space-y-4">
                <div className="flex items-center gap-3 px-1">
                  <div className="w-9 h-9 rounded-xl bg-foreground/10 flex items-center justify-center text-sm font-bold text-foreground">
                    {i + 1}
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">{result.patientName}</h3>
                    <p className="text-xs text-muted-foreground">{result.surgeryType}</p>
                  </div>
                </div>

                <BlocoResumo content={result.blocoResumo} patientName={result.patientName} />
                <RelatorioTecnico content={result.relatorioTecnico} patientName={result.patientName} />
              </div>
            ))}

            <div className="flex justify-center pt-2 pb-10">
              <Button onClick={resetAll} variant="outline" className="gap-2 rounded-xl h-11">
                <RotateCcw className="w-4 h-4" />
                Nova avaliação
              </Button>
            </div>
          </div>
        )}

        {results && results.length === 0 && (
          <div className="text-center py-16">
            <p className="text-muted-foreground mb-6">
              Nenhum paciente identificado nos arquivos enviados.
            </p>
            <Button onClick={resetAll} variant="outline" className="gap-2 rounded-xl">
              <RotateCcw className="w-4 h-4" />
              Tentar novamente
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}