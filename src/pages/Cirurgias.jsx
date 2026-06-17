import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Plus, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import SurgeryCard from "@/components/cirurgias/SurgeryCard";
import SurgeryForm from "@/components/cirurgias/SurgeryForm";

export default function Cirurgias() {
  const [surgeries, setSurgeries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const loadSurgeries = async () => {
    const data = await base44.entities.Surgery.list();
    setSurgeries(data);
    setLoading(false);
  };

  useEffect(() => { loadSurgeries(); }, []);

  const handleSave = async (data) => {
    if (editing) {
      await base44.entities.Surgery.update(editing.id, data);
    } else {
      await base44.entities.Surgery.create(data);
    }
    setShowForm(false);
    setEditing(null);
    loadSurgeries();
  };

  const handleDelete = async (surgery) => {
    await base44.entities.Surgery.delete(surgery.id);
    loadSurgeries();
  };

  const handleEdit = (surgery) => {
    setEditing(surgery);
    setShowForm(true);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-6 sm:py-10">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">
            Gerenciar Cirurgias
          </h1>
        </div>

        <p className="text-sm text-muted-foreground mb-6">
          Cadastre os tipos de cirurgia e defina quais exames são obrigatórios para cada uma. Essas definições serão usadas automaticamente na triagem.
        </p>

        {!showForm && (
          <Button onClick={() => { setEditing(null); setShowForm(true); }} className="mb-6 bg-primary hover:bg-primary/90 text-primary-foreground gap-2">
            <Plus className="w-4 h-4" /> Nova cirurgia
          </Button>
        )}

        {showForm && (
          <div className="mb-6">
            <SurgeryForm
              surgery={editing}
              onSave={handleSave}
              onCancel={() => { setShowForm(false); setEditing(null); }}
            />
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : surgeries.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Nenhuma cirurgia cadastrada ainda.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {surgeries.map((s) => (
              <SurgeryCard key={s.id} surgery={s} onEdit={handleEdit} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}