"use client";

import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { cn } from "@/lib/utils";

interface StyleCardProps {
  id: string;
  flag: string;
  name: string;
  description: string;
  selected: boolean;
  onSelect: (id: string) => void;
}

export default function StyleCard({
  id,
  flag,
  name,
  description,
  selected,
  onSelect,
}: StyleCardProps) {
  const { copy, isArabic } = useThemeLanguage();

  return (
    <button
      onClick={() => onSelect(id)}
      className={cn(
        "style-card-base w-full rounded-xl p-6",
        isArabic ? "text-right" : "text-left",
        selected && "style-card-selected"
      )}
    >
      <span className="mb-3 block text-4xl">{flag}</span>

      <h3
        className={cn(
          "mb-2 text-xl font-semibold text-[var(--dd-text)]",
          isArabic ? "font-arabic" : "font-display"
        )}
      >
        {name}
      </h3>

      <p
        className={cn(
          "text-sm leading-relaxed text-[var(--dd-text-secondary)]",
          isArabic && "font-arabic"
        )}
      >
        {description}
      </p>

      <div
        className={cn(
          "mt-4 flex items-center gap-2",
          isArabic && "flex-row-reverse justify-end"
        )}
      >
        <div
          className={cn(
            "h-4 w-4 rounded-full border-2 transition-all duration-300",
            selected
              ? "border-[var(--dd-gold)] bg-[var(--dd-gold)]"
              : "border-[var(--dd-text-secondary)] bg-transparent"
          )}
        />
        <span
          className={cn(
            "text-xs transition-colors duration-300",
            selected ? "text-[var(--dd-gold)]" : "text-[var(--dd-text-secondary)]",
            isArabic && "font-arabic"
          )}
        >
          {selected ? copy.shared.styleSelector.selected : copy.shared.styleSelector.select}
        </span>
      </div>
    </button>
  );
}
