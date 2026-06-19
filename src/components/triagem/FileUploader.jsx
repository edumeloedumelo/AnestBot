import { useState } from "react";
import { Upload, AlertCircle } from "lucide-react";

export default function FileUploader({ files, setFiles, disabled }) {
  const [errors, setErrors] = useState([]);
  const ALLOWED_EXT = ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "pdf", "txt", "csv", "xlsx", "xls"];
  const MAX_SIZE = 150 * 1024 * 1024;

  const validateFile = (file) => {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const typeOk = file.type.startsWith("image/") || file.type === "application/pdf" || file.type.startsWith("text/");
    if (!typeOk && !ALLOWED_EXT.includes(ext)) {
      return { valid: false, error: `Tipo não suportado: ${file.name}` };
    }
    if (file.size > MAX_SIZE) {
      return { valid: false, error: `Arquivo muito grande (máx 150MB): ${file.name}` };
    }
    return { valid: true };
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (disabled) return;
    const dropped = Array.from(e.dataTransfer.files);
    addFiles(dropped);
  };

  const handleSelect = (e) => {
    if (disabled) return;
    const selected = Array.from(e.target.files);
    addFiles(selected);
    e.target.value = "";
  };

  const addFiles = (newFiles) => {
    const valid = [];
    const errs = [];
    for (const f of newFiles) {
      const result = validateFile(f);
      if (!result.valid) { errs.push(result.error); continue; }
      Object.defineProperty(f, 'preview', { value: URL.createObjectURL(f), writable: true, configurable: true });
      valid.push(f);
    }
    setErrors(errs);
    setFiles((prev) => [...prev, ...valid]);
  };

  const removeFile = (index) => {
    setFiles((prev) => {
      const updated = [...prev];
      if (updated[index]?.preview) URL.revokeObjectURL(updated[index].preview);
      updated.splice(index, 1);
      return updated;
    });
  };

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className={`border-2 border-dashed rounded-2xl p-6 sm:p-10 text-center cursor-pointer transition-colors
          ${disabled ? "opacity-40 cursor-not-allowed border-[#1a1a1a]" : "border-[#2d2d2d] hover:border-[#555] active:border-[#808080]"}
          bg-[#0a0a0a]`}
        onClick={() => !disabled && document.getElementById("file-input")?.click()}
      >
        <Upload className="w-8 h-8 text-[#555] mx-auto mb-4" />
        <p className="text-xs font-bold text-white uppercase tracking-[0.15em] mb-2">
          Carregar arquivos
        </p>
        <p className="text-[11px] text-[#555]">
          Arraste arquivos ou toque para selecionar
        </p>
        <p className="text-[10px] text-[#555] mt-2">
          No celular: escolha "Câmera" ou "Galeria"
        </p>
        <p className="text-[10px] text-[#444] mt-1">
          JPEG, PNG, PDF, TXT — até 150MB
        </p>
        <input
          id="file-input"
          type="file"
          multiple
          accept="image/*,.pdf,.txt,.webp,.xlsx,.xls,.csv"
          onChange={handleSelect}
          className="hidden"
          disabled={disabled}
        />
      </div>

      {/* Rejected files */}
      {errors.length > 0 && (
        <div className="space-y-1.5">
          {errors.map((err, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px] text-[#ff4444]">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{err}</span>
            </div>
          ))}
        </div>
      )}

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-[#808080] uppercase tracking-[0.15em]">
            {files.length} arquivo{files.length > 1 ? "s" : ""} selecionado{files.length > 1 ? "s" : ""}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {files.map((file, i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-3 bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white truncate font-medium">{file.name}</p>
                  <p className="text-[10px] text-[#555]">{formatSize(file.size)}</p>
                </div>
                {!disabled && (
                  <button
                    onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                    className="text-[#555] hover:text-[#ff4444] transition-colors text-lg leading-none"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}