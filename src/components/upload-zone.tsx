"use client";

import { useCallback, useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { cn } from "@/lib/utils";

interface UploadZoneProps {
  onImageSelect: (file: File) => void;
  imagePreviewUrl: string | null;
  onRemove: () => void;
}

const MAX_SIZE = 10 * 1024 * 1024;
const MIN_DIM = 256;

async function readDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const dims = { width: img.naturalWidth, height: img.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(dims);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

export default function UploadZone({
  onImageSelect,
  imagePreviewUrl,
  onRemove,
}: UploadZoneProps) {
  const { copy, isArabic } = useThemeLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validate = useCallback(
    async (file: File): Promise<boolean> => {
      if (!file.type.startsWith("image/")) {
        setError(copy.shared.upload.invalidType);
        return false;
      }

      if (file.size > MAX_SIZE) {
        setError(copy.shared.upload.invalidSize);
        return false;
      }

      try {
        const { width, height } = await readDimensions(file);
        if (Math.min(width, height) < MIN_DIM) {
          setError(copy.shared.upload.invalidDimensions);
          return false;
        }
      } catch {
        setError(copy.shared.upload.invalidType);
        return false;
      }

      setError(null);
      return true;
    },
    [
      copy.shared.upload.invalidSize,
      copy.shared.upload.invalidType,
      copy.shared.upload.invalidDimensions,
    ],
  );

  const handleFile = useCallback(
    async (file: File) => {
      if (await validate(file)) {
        onImageSelect(file);
      }
    },
    [onImageSelect, validate],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragOver(false);
      const file = event.dataTransfer.files[0];

      if (file) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];

      if (file) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  if (imagePreviewUrl) {
    return (
      <div className="relative mx-auto aspect-video max-w-2xl overflow-hidden rounded-2xl">
        <img
          src={imagePreviewUrl}
          alt={copy.shared.upload.previewAlt}
          className="h-full w-full object-cover animate-fade-in-up"
        />
        <button
          onClick={onRemove}
          className={cn(
            "absolute top-3 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--dd-glass-bg)] text-[var(--dd-text)] transition-all duration-300 hover:bg-[var(--error)]",
            isArabic ? "left-3" : "right-3"
          )}
          aria-label={copy.shared.upload.removeImage}
        >
          <X size={18} />
        </button>
      </div>
    );
  }

  return (
    <div>
      <div
        className={cn(
          "upload-zone-dashed mx-auto max-w-2xl cursor-pointer rounded-2xl p-12 text-center md:p-16",
          dragOver && "dragover"
        )}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <Upload size={48} className="mx-auto mb-4 text-[var(--dd-gold)]" />
        <p
          className={cn(
            "mb-2 text-base text-[var(--dd-text)] md:text-lg",
            isArabic && "font-arabic"
          )}
        >
          {copy.shared.upload.dragPrompt}
        </p>
        <p
          className={cn(
            "text-sm text-[var(--dd-text-secondary)]",
            isArabic && "font-arabic"
          )}
        >
          {copy.shared.upload.clickPrompt}
        </p>
        <p
          className={cn(
            "mt-6 text-xs text-[var(--dd-text-secondary)]",
            isArabic && "font-arabic"
          )}
        >
          {copy.shared.upload.formats}
        </p>
      </div>

      {error && (
        <p className={cn("mt-3 text-center text-sm text-[var(--error)]", isArabic && "font-arabic")}>
          {error}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleChange}
      />
    </div>
  );
}
