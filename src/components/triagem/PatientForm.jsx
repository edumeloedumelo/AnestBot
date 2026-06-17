import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SURGERY_TYPES = [
  { value: "protese_mamaria", label: "Inclusão de prótese mamária" },
  { value: "mastopexia", label: "Mastopexia (com ou sem prótese)" },
  { value: "abdominoplastia", label: "Abdominoplastia" },
  { value: "lipoaspiracao", label: "Lipoaspiração / Lipoescultura" },
  { value: "combinada", label: "Cirurgia combinada" },
];

export default function PatientForm({ patientName, setPatientName, surgeryType, setSurgeryType, anamnesis, setAnamnesis, disabled }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="patientName" className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Nome da paciente
          </Label>
          <Input
            id="patientName"
            placeholder="Nome completo"
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            disabled={disabled}
            className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="surgeryType" className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Tipo de cirurgia
          </Label>
          <Select value={surgeryType} onValueChange={setSurgeryType} disabled={disabled}>
            <SelectTrigger id="surgeryType" className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700">
              <SelectValue placeholder="Selecione o tipo de cirurgia" />
            </SelectTrigger>
            <SelectContent>
              {SURGERY_TYPES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="anamnesis" className="text-sm font-medium text-slate-700 dark:text-slate-300">
          Anamnese / Observações clínicas <span className="text-slate-400 font-normal">(opcional)</span>
        </Label>
        <Textarea
          id="anamnesis"
          placeholder="Comorbidades, histórico cirúrgico, medicações de uso contínuo, alergias, IMC, idade..."
          value={anamnesis}
          onChange={(e) => setAnamnesis(e.target.value)}
          disabled={disabled}
          rows={3}
          className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 resize-none"
        />
      </div>
    </div>
  );
}