import { X, FileText, Image, FileArchive } from "lucide-react";

function getFileIcon(file) {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (["jpg", "jpeg", "png", "webp"].includes(ext)) return Image;
  if (ext === "pdf") return FileArchive;
  return FileText;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FilePreview({ files, onRemove, disabled }) {
  if (!files.length) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {files.map((file, index) => {
        const Icon = getFileIcon(file);
        const isImage = ["jpg", "jpeg", "png", "webp"].includes(
          file.name.split(".").pop()?.toLowerCase()
        );

        return (
          <div
            key={`${file.name}-${index}`}
            className="relative group rounded-lg border border-border bg-card overflow-hidden"
          >
            {isImage ? (
              <div className="aspect-square flex items-center justify-center bg-muted">
                <img
                  src={URL.createObjectURL(file)}
                  alt={file.name}
                  className="w-full h-full object-cover"
                />
              </div>
            ) : (
              <div className="aspect-square flex flex-col items-center justify-center gap-2 p-3 bg-muted">
                <Icon className="w-8 h-8 text-muted-foreground" />
                <span className="text-xs text-muted-foreground uppercase font-medium">
                  {file.name.split(".").pop()}
                </span>
              </div>
            )}

            <div className="p-2">
              <p className="text-xs text-foreground/80 truncate" title={file.name}>
                {file.name}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {formatSize(file.size)}
              </p>
            </div>

            {!disabled && (
              <button
                onClick={() => onRemove(index)}
                className="absolute top-1 right-1 w-5 h-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}