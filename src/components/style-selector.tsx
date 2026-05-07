"use client";

import type { StyleId } from "@/context/ImageContext";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import StyleCard from "@/components/style-card";
import { cn } from "@/lib/utils";

const styleOrder: StyleId[] = ["lebanese", "khaleeji", "moroccan"];

interface StyleSelectorProps {
  selectedStyle: string | null;
  onStyleSelect: (style: string) => void;
}

export default function StyleSelector({
  selectedStyle,
  onStyleSelect,
}: StyleSelectorProps) {
  const { copy, isArabic } = useThemeLanguage();

  return (
    <div>
      <h2
        className={cn(
          "mb-6 text-2xl font-semibold text-[var(--dd-text)]",
          isArabic ? "font-arabic text-right" : "font-display text-left"
        )}
      >
        {copy.shared.styleSelector.title}
      </h2>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {styleOrder.map((styleId) => {
          const style = copy.shared.styles[styleId];

          return (
            <StyleCard
              key={styleId}
              id={styleId}
              flag={style.flag}
              name={style.name}
              description={style.selectorDescription}
              selected={selectedStyle === styleId}
              onSelect={onStyleSelect}
            />
          );
        })}
      </div>
    </div>
  );
}
