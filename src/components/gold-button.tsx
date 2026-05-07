"use client";

import Link from "next/link";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { cn } from "@/lib/utils";

interface GoldButtonProps {
  children: React.ReactNode;
  href?: string;
  disabled?: boolean;
  className?: string;
  onClick?: () => void;
}

export default function GoldButton({
  children,
  href,
  disabled = false,
  className,
  onClick,
}: GoldButtonProps) {
  const { isArabic } = useThemeLanguage();

  const baseClass = cn(
    "shimmer-btn inline-flex items-center justify-center gap-2 rounded-xl px-8 py-3.5 text-lg font-semibold text-[var(--dd-ink)] transition-all duration-300",
    isArabic ? "font-arabic" : "font-ui",
    className
  );

  if (href && !disabled) {
    return (
      <Link href={href} className={baseClass}>
        {children}
      </Link>
    );
  }

  return (
    <button className={baseClass} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}
