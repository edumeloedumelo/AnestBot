import { useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";
import PatientForm from "@/components/triagem/PatientForm";
import FileUploader from "@/components/triagem/FileUploader";
import ProgressIndicator from "@/components/triagem/ProgressIndicator";
import RelatorioTecnico from "@/components/triagem/RelatorioTecnico";
import BlocoResumo from "@/components/triagem/BlocoResumo";
import SecurityNotice from "@/components/triagem/SecurityNotice";

export default function Triagem() {
  const [patientName, setPatientName] = useState("");
  const [surgeryType, setSurgeryType] = useState("");
  const [anamnesis, setAnamnesis] = useState("");
  const [files, setFiles] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [progressStatus, setProgressStatus] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const canAnalyze = patientName.trim() && surgeryType && files.length > 0 && !analyzing;

  const resetAll = useCallback(() => {
    // Revoke object URLs to free memory
    files.forEach((f) => {
      if (f.preview) URL.revokeObjectURL(f.preview);
    });
    setPatientName("");
    setSurgeryType("");
    setAnamnesis("");
    setFiles([]);
    setAnalyzing(false);
    setProgressStatus("");
    setError("");
    setResult(null);
  }, [files]);

  const handleAnalyze = async () => {
    if (!canAnalyze) return;
    setAnalyzing(true);
    setError("");
    setResult(null);

    try {
      // Step 1: Upload files
      setProgressStatus("uploading");
      const fileUrls = [];

      for (const file of files) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        fileUrls.push(file_url);
      }

      // Step 2: Analyze
      setProgressStatus("analyzing");

      const response = await base44.functions.invoke("analyzePreOp", {
        patientName,
        surgeryType,
        anamnesis,
        fileUrls,
      });

      if (response.data?.error) {
        setError(response.data.error);
        setAnalyzing(false);
        return;
      }

      // Step 3: Generate
      setProgressStatus("generating");

      setResult({
        relatorioTecnico: response.data.relatorioTecnico || "Relatório não gerado.",
        blocoResumo: response.data.blocoResumo || "Resumo não gerado.",
      });

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
        {!result && (
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 sm:p-6 mb-6">
            <PatientForm
              patientName={patientName}
              setPatientName={setPatientName}
              surgeryType={surgeryType}
              setSurgeryType={setSurgeryType}
              anamnesis={anamnesis}
              setAnamnesis={setAnamnesis}
              disabled={analyzing}
            />

            <div className="mt-6">
              <FileUploader
                files={files}
                setFiles={setFiles}
                disabled={analyzing}
              />
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
        {result && (
          <div className="space-y-6">
            <RelatorioTecnico content={result.relatorioTecnico} patientName={patientName} />
            <BlocoResumo content={result.blocoResumo} patientName={patientName} />

            {/* Nova Triagem */}
            <div className="flex justify-center pt-2">
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
      </div>
    </div>
  );
}