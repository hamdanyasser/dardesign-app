"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Link2, X } from "lucide-react";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { cn } from "@/lib/utils";

interface ShareDialogProps {
  url: string | null;
  onClose: () => void;
  open: boolean;
}

export default function ShareDialog({ url, onClose, open }: ShareDialogProps) {
  const { isArabic } = useThemeLanguage();
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.select();
    }
  }, [open]);

  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      inputRef.current?.select();
      document.execCommand?.("copy");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "w-full max-w-md rounded-2xl border border-[var(--dd-gold-dim)] bg-charcoal-soft p-6 shadow-2xl",
          isArabic && "text-right",
        )}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2
            className={cn(
              "flex items-center gap-2 text-lg font-semibold text-gold",
              isArabic ? "font-arabic flex-row-reverse" : "font-display",
            )}
          >
            <Link2 size={18} />
            {isArabic ? "مشاركة الناتج" : "Share result"}
          </h2>
          <button
            onClick={onClose}
            className="text-cream-muted transition hover:text-cream"
            aria-label={isArabic ? "إغلاق" : "Close"}
          >
            <X size={20} />
          </button>
        </div>

        <p
          className={cn(
            "mb-3 text-sm text-cream-muted",
            isArabic ? "font-arabic" : "font-ui",
          )}
        >
          {isArabic
            ? "الرابط صالح لمدة 7 أيام، انسخه وأرسله للمراجعين."
            : "Link valid for 7 days. Copy and share with reviewers."}
        </p>

        <div className="flex gap-2">
          <input
            ref={inputRef}
            readOnly
            value={url ?? ""}
            className="flex-1 rounded-lg border border-[var(--dd-gold-dim)] bg-charcoal px-3 py-2 text-sm text-cream font-ui"
          />
          <button
            onClick={handleCopy}
            className={cn(
              "flex items-center gap-1 rounded-lg border border-gold px-3 py-2 text-sm font-semibold text-gold transition-all duration-300 hover:bg-gold hover:text-[var(--dd-ink)]",
              isArabic && "font-arabic",
            )}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied
              ? isArabic ? "نُسخ" : "Copied"
              : isArabic ? "نسخ" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
