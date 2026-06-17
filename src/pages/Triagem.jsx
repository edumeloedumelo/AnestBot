import { useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RotateCcw } from "lucide-react";
import FileUploader from "@/components/triagem/FileUploader";
import ProgressIndicator from "@/components/triagem/ProgressIndicator";
import RelatorioTecnico from "@/components/triagem/RelatorioTecnico";
import BlocoResumo from "@/components/triagem/BlocoResumo";
import SecurityNotice from "@/components/triagem/SecurityNotice";

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
      // Step 1: Upload all files
      setProgressStatus("uploading");
      const fileUrls = [];
      for (const file of files) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        fileUrls.push(file_url);
      }

      // Step 2: Analyze batch - identifies patients and runs triage
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
    <div className="min-h-screen bg-[#F8F9FA] dark:bg-slate-950">
      <div className="max-w-3xl mx-auto px-4 py-6 sm:py-10">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white mb-1">
            Triagem Pré-Anestésica
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Cirurgias plásticas eletivas — apoio à decisão clínica
          </p>
        </div>

        {/* Security Notice */}
        <div className="mb-6">
          <SecurityNotice />
        </div>

        {/* Form Card */}
        {!results && (
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 sm:p-6 mb-6">
            <div className="space-y-4">
              <FileUploader
                files={files}
                setFiles={setFiles}
                disabled={analyzing}
              />

              <div className="space-y-2">
                <Label htmlFor="anamnesis" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Anamnese / Observações clínicas <span className="text-slate-400 font-normal">(opcional — aplicado a todos os pacientes)</span>
                </Label>
                <Textarea
                  id="anamnesis"
                  placeholder="Comorbidades, histórico cirúrgico, medicações de uso contínuo, alergias, IMC, idade..."
                  value={anamnesis}
                  onChange={(e) => setAnamnesis(e.target.value)}
                  disabled={analyzing}
                  rows={3}
                  className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 resize-none"
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="mt-4 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
              </div>
            )}

            {/* Analyze Button */}
            <div className="mt-6 flex justify-end">
              <Button
                onClick={handleAnalyze}
                disabled={!canAnalyze}
                className="bg-blue-600 hover:bg-blue-700 text-white px-8 h-11 text-sm font-medium"
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
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {results.length} paciente{results.length > 1 ? "s" : ""} encontrado{results.length > 1 ? "s" : ""}
              </p>
            </div>

            {results.map((result, i) => (
              <div key={i} className="space-y-4">
                {/* Patient header */}
                <div className="flex items-center gap-3 px-1">
                  <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-sm font-bold text-blue-700 dark:text-blue-300">
                    {i + 1}
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-800 dark:text-slate-100">
                      {result.patientName}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {({protese_mamaria:"Prótese Mamária",mastopexia:"Mastopexia",abdominoplastia:"Abdominoplastia",lipoaspiracao:"Lipoaspiração",combinada:"Combinada",indefinida:"Não identificada"})[result.surgeryType] || result.surgeryType}
                    </p>
                  </div>
                </div>

                {/* WhatsApp Summary Card */}
                <BlocoResumo content={result.blocoResumo} patientName={result.patientName} />

                {/* Technical Report Card */}
                <RelatorioTecnico content={result.relatorioTecnico} patientName={result.patientName} />
              </div>
            ))}

            {/* Nova Triagem */}
            <div className="flex justify-center pt-4">
              <Button
                onClick={resetAll}
                variant="outline"
                className="gap-2 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
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
            <p className="text-slate-500 dark:text-slate-400 mb-4">
              Nenhum paciente identificado nos arquivos enviados.
            </p>
            <Button
              onClick={resetAll}
              variant="outline"
              className="gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Tentar novamente
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}