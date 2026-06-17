import { useCallback, useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import FilePreview from "./FilePreview";

const ACCEPTED_TYPES = ".txt,.jpg,.jpeg,.png,.webp,.pdf";
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

export default function FileUploader({ files, setFiles, disabled }) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  const validateAndAdd = useCallback((newFiles) => {
    setError("");
    const valid = [];

    for (const file of newFiles) {
      const ext = file.name.split(".").pop()?.toLowerCase();
      const allowed = ["txt", "jpg", "jpeg", "png", "webp", "pdf"];

      if (!allowed.includes(ext)) {
        setError(`Formato não suportado: ${file.name}`);
        continue;
      }

      if (file.size > MAX_FILE_SIZE) {
        setError(`Arquivo muito grande (máx. 25MB): ${file.name}`);
        continue;
      }

      valid.push(file);
    }

    if (valid.length > 0) {
      setFiles((prev) => [...prev, ...valid]);
    }
  }, [setFiles]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    validateAndAdd(Array.from(e.dataTransfer.files));
  }, [disabled, validateAndAdd]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  }, [disabled]);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleFileSelect = useCallback((e) => {
    if (e.target.files?.length) {
      validateAndAdd(Array.from(e.target.files));
    }
    e.target.value = "";
  }, [validateAndAdd]);

  const removeFile = useCallback((index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, [setFiles]);

  return (
    <div className="space-y-3">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`
          relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer
          transition-all duration-200
          ${isDragging
            ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20"
            : "border-slate-300 dark:border-slate-600 hover:border-blue-400 dark:hover:border-blue-500 bg-slate-50 dark:bg-slate-800/50"
          }
          ${disabled ? "opacity-50 pointer-events-none" : ""}
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          multiple
          onChange={handleFileSelect}
          className="hidden"
          disabled={disabled}
        />

        <Upload className="w-10 h-10 text-slate-400 dark:text-slate-500 mx-auto mb-3" />
        <p className="text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">
          Arraste os arquivos aqui ou clique para selecionar
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          .txt, .jpg, .jpeg, .png, .webp, .pdf — até 25MB cada
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 px-1">{error}</p>
      )}

      {files.length > 0 && (
        <FilePreview files={files} onRemove={removeFile} disabled={disabled} />
      )}
    </div>
  );
}