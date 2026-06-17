import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export default function ExamLimitForm({ limit, onSave, onCancel }) {
  const [examName, setExamName] = useState(limit?.exam_name || "");
  const [description, setDescription] = useState(limit?.description || "");
  const [ruleType, setRuleType] = useState(limit?.rule_type || "min");
  const [minValue, setMinValue] = useState(limit?.min_value ?? "");
  const [maxValue, setMaxValue] = useState(limit?.max_value ?? "");
  const [unit, setUnit] = useState(limit?.unit || "");
  const [notes, setNotes] = useState(limit?.notes || "");
  const [saving, setSaving] = useState(false);

  const showMin = ruleType === "min" || ruleType === "range";
  const showMax = ruleType === "max" || ruleType === "range";

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!examName.trim() || !description.trim()) return;
    setSaving(true);
    const data = {
      exam_name: examName.trim(),
      description: description.trim(),
      rule_type: ruleType,
      unit: unit.trim(),
      notes: notes.trim(),
    };
    if (showMin && minValue !== "") data.min_value = Number(minValue);
    if (showMax && maxValue !== "") data.max_value = Number(maxValue);
    await onSave(data);
    setSaving(false);
  };

  return (
    <form onSubmit={handleSubmit} className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-sm text-foreground/80">Nome do exame</Label>
          <Input value={examName} onChange={(e) => setExamName(e.target.value)} placeholder="Ex: Hemoglobina" className="bg-background border-border" />
        </div>
        <div className="space-y-2">
          <Label className="text-sm text-foreground/80">Unidade</Label>
          <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Ex: g/dL, mg/L" className="bg-background border-border" />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-sm text-foreground/80">Regra descritiva</Label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex: ≥ 12 g/dL" className="bg-background border-border" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label className="text-sm text-foreground/80">Tipo de regra</Label>
          <Select value={ruleType} onValueChange={(v) => { setRuleType(v); if (v === "flag" || v === "interpretation") { setMinValue(""); setMaxValue(""); } }}>
            <SelectTrigger className="bg-background border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="min">Valor mínimo</SelectItem>
              <SelectItem value="max">Valor máximo</SelectItem>
              <SelectItem value="range">Faixa (min-máx)</SelectItem>
              <SelectItem value="flag">Positivo/Negativo</SelectItem>
              <SelectItem value="interpretation">Interpretação</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {showMin && (
          <div className="space-y-2">
            <Label className="text-sm text-foreground/80">Valor mínimo</Label>
            <Input type="number" step="any" value={minValue} onChange={(e) => setMinValue(e.target.value)} placeholder="0" className="bg-background border-border" />
          </div>
        )}

        {showMax && (
          <div className="space-y-2">
            <Label className="text-sm text-foreground/80">Valor máximo</Label>
            <Input type="number" step="any" value={maxValue} onChange={(e) => setMaxValue(e.target.value)} placeholder="0" className="bg-background border-border" />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label className="text-sm text-foreground/80">Observações clínicas</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas adicionais sobre a interpretação..." className="bg-background border-border h-20" />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" disabled={saving || !examName.trim() || !description.trim()} className="bg-primary hover:bg-primary/90 text-primary-foreground">
          {saving ? "Salvando..." : "Salvar limite"}
        </Button>
      </div>
    </form>
  );
}