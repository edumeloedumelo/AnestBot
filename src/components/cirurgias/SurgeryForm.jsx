import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

const EXAM_OPTIONS = [
  "Hemograma completo",
  "Coagulograma (TP/INR, TTPA)",
  "Ionograma (Na, K, Cl)",
  "Bioquímica renal (ureia, creatinina)",
  "Mamografia / USG de mamas",
  "Sorologias (HIV, Hep B, Hep C)",
  "Beta-HCG",
  "Urina / EAS",
  "ECG / Eletrocardiograma",
  "RX de tórax",
  "Risco cirúrgico",
  "USG de abdome total",
  "USG de parede abdominal",
];

export default function SurgeryForm({ surgery, onSave, onCancel }) {
  const [name, setName] = useState(surgery?.name || "");
  const [key, setKey] = useState(surgery?.key || "");
  const [exams, setExams] = useState(surgery?.required_exams || []);
  const [newExam, setNewExam] = useState("");
  const [saving, setSaving] = useState(false);

  const addExam = () => {
    const trimmed = newExam.trim();
    if (trimmed && !exams.includes(trimmed)) {
      setExams([...exams, trimmed]);
    }
    setNewExam("");
  };

  const removeExam = (exam) => {
    setExams(exams.filter((e) => e !== exam));
  };

  const toggleExamOption = (exam) => {
    if (exams.includes(exam)) {
      setExams(exams.filter((e) => e !== exam));
    } else {
      setExams([...exams, exam]);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !key.trim()) return;
    setSaving(true);
    await onSave({ name: name.trim(), key: key.trim().toLowerCase().replace(/\s+/g, "_"), required_exams: exams });
    setSaving(false);
  };

  return (
    <form onSubmit={handleSubmit} className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-2xl p-5 space-y-4 shadow-lg shadow-black/5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-sm text-foreground/80">Nome da cirurgia</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Inclusão de prótese mamária"
            className="bg-background/80 border-border/50 rounded-2xl focus:border-primary/40 transition-all duration-300"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-sm text-foreground/80">Chave (identificador)</Label>
          <Input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Ex: protese_mamaria"
            className="bg-background/80 border-border/50 rounded-2xl focus:border-primary/40 transition-all duration-300"
          />
        </div>
      </div>

      {/* Quick select from options */}
      <div className="space-y-2">
        <Label className="text-sm text-foreground/80">Exames obrigatórios</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {EXAM_OPTIONS.map((exam) => (
            <label
              key={exam}
              className={`flex items-center gap-2 px-3 py-2 rounded-2xl border cursor-pointer transition-all duration-300 text-sm ${
                exams.includes(exam)
                  ? "border-primary/40 bg-primary/10 text-foreground shadow-sm"
                  : "border-border/50 bg-background/80 text-muted-foreground hover:border-primary/30"
              }`}
            >
              <input
                type="checkbox"
                checked={exams.includes(exam)}
                onChange={() => toggleExamOption(exam)}
                className="rounded accent-primary"
              />
              {exam}
            </label>
          ))}
        </div>
      </div>

      {/* Custom exam input */}
      <div className="flex gap-2">
        <Input
          value={newExam}
          onChange={(e) => setNewExam(e.target.value)}
          placeholder="Ou digite um exame personalizado..."
          className="bg-background border-border flex-1"
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addExam())}
        />
        <Button type="button" variant="outline" onClick={addExam} size="icon" className="h-9 w-9 rounded-2xl">
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      {/* Custom exams added */}
      {exams.filter((e) => !EXAM_OPTIONS.includes(e)).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {exams.filter((e) => !EXAM_OPTIONS.includes(e)).map((exam) => (
            <span key={exam} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs">
              {exam}
              <button onClick={() => removeExam(exam)} className="hover:text-destructive">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} className="rounded-2xl">
          Cancelar
        </Button>
        <Button type="submit" disabled={saving || !name.trim() || !key.trim()} className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-2xl shadow-lg shadow-primary/10 transition-all duration-300">
          {saving ? "Salvando..." : "Salvar cirurgia"}
        </Button>
      </div>
    </form>
  );
}