import { useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RotateCcw, Settings } from "lucide-react";
import { Link } from "react-router-dom";
import FileUploader from "@/components/triagem/FileUploader";
import ProgressIndicator from "@/components/triagem/ProgressIndicator";
import RelatorioTecnico from "@/components/triagem/RelatorioTecnico";
import BlocoResumo from "@/components/triagem/BlocoResumo";
import SecurityNotice from "@/components/triagem/SecurityNotice";

const SURGERY_LABELS = {
  protese_mamaria: "Prótese Mamária",
  mastopexia: "Mastopexia",
  abdominoplastia: "Abdominoplastia",
  lipoaspiracao: "Lipoaspiração",
  combinada: "Combinada",
  indefinida: "Não identificada",
};

export default function Triagem() {
  const [anamnesis, setAnamnesis] = useState("");
  const [files, setFiles] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [progressStatus, setProgressStatus] = useState("");
  const [error, setError] = useState("");
  const [results, setResults] = useState(null);

  const canAnalyze = files.length > 0 && !analyzing;

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
    } catch (err) {
      setError(err?.response?.data?.error || "Erro ao processar. Verifique sua conexão e tente novamente.");
      setAnalyzing(false);
      setProgressStatus("");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-6 sm:py-10">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-1">
              Triagem Pré-Anestésica
            </h1>
            <p className="text-sm text-muted-foreground">
              Cirurgias plásticas eletivas — apoio à decisão clínica
            </p>
          </div>
          <Link
            to="/cirurgias"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-lg border border-border hover:border-primary/40"
          >
            <Settings className="w-3.5 h-3.5" />
            Cirurgias
          </Link>
        </div>

        {/* Security Notice */}
        <div className="mb-6">
          <SecurityNotice />
        </div>

        {/* Form Card */}
        {!results && (
          <div className="bg-card rounded-xl border border-border shadow-sm p-5 sm:p-6 mb-6">
            <div className="space-y-4">
              <FileUploader
                files={files}
                setFiles={setFiles}
                disabled={analyzing}
              />

              <div className="space-y-2">
                <Label htmlFor="anamnesis" className="text-sm font-medium text-foreground/80">
                  Anamnese / Observações clínicas <span className="text-muted-foreground font-normal">(opcional — aplicado a todos os pacientes)</span>
                </Label>
                <Textarea
                  id="anamnesis"
                  placeholder="Comorbidades, histórico cirúrgico, medicações de uso contínuo, alergias, IMC, idade..."
                  value={anamnesis}
                  onChange={(e) => setAnamnesis(e.target.value)}
                  disabled={analyzing}
                  rows={3}
                  className="bg-background border-border resize-none"
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="mt-4 p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            {/* Analyze Button */}
            <div className="mt-6 flex justify-end">
              <Button
                onClick={handleAnalyze}
                disabled={!canAnalyze}
                className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 h-11 text-sm font-medium"
              >
                Analisar
              </Button>
            </div>
          </div>
        )}

        {/* Progress */}
        {analyzing && <ProgressIndicator status={progressStatus} />}

        {/* Results */}
        {results && results.length > 0 && (
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {results.length} paciente{results.length > 1 ? "s" : ""} encontrado{results.length > 1 ? "s" : ""}
              </p>
            </div>

            {results.map((result, i) => (
              <div key={i} className="space-y-4">
                {/* Patient header */}
                <div className="flex items-center gap-3 px-1">
                  <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center text-sm font-bold text-primary">
                    {i + 1}
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">
                      {result.patientName}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {SURGERY_LABELS[result.surgeryType] || result.surgeryType}
                    </p>
                  </div>
                </div>

                <BlocoResumo content={result.blocoResumo} patientName={result.patientName} />
                <RelatorioTecnico content={result.relatorioTecnico} patientName={result.patientName} />
              </div>
            ))}

            <div className="flex justify-center pt-4">
              <Button
                onClick={resetAll}
                variant="outline"
                className="gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Nova triagem
              </Button>
            </div>
          </div>
        )}

        {/* No patients found */}
        {results && results.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-4">
              Nenhum paciente identificado nos arquivos enviados.
            </p>
            <Button onClick={resetAll} variant="outline" className="gap-2">
              <RotateCcw className="w-4 h-4" />
              Tentar novamente
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}