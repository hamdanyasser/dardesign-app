"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  Activity,
  BarChart3,
  Boxes,
  CreditCard,
  History,
  LayoutDashboard,
  LogIn,
  LogOut,
  Menu,
  Moon,
  Palette,
  ShieldCheck,
  Sparkles,
  Sun,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { cn } from "@/lib/utils";

type NavigationItem = {
  href: string;
  label: { en: string; ar: string };
  icon: typeof Sparkles;
  admin?: boolean;
};

const mainNavigation: NavigationItem[] = [
  { href: "/studio", label: { en: "Studio", ar: "الاستوديو" }, icon: Sparkles },
  // Build Mode had no way in but a Studio result or a typed URL, which made
  // the room planner effectively undiscoverable.
  { href: "/design", label: { en: "Build Mode", ar: "وضع البناء" }, icon: Boxes },
  {
    href: "/history",
    label: { en: "My designs", ar: "تصاميمي" },
    icon: History,
  },
  { href: "/others", label: { en: "Community", ar: "المجتمع" }, icon: Palette },
  {
    href: "/subscription",
    label: { en: "Plan & usage", ar: "الخطة والاستخدام" },
    icon: CreditCard,
  },
];

const adminNavigation: NavigationItem[] = [
  {
    href: "/admin/analytics",
    label: { en: "Analytics", ar: "التحليلات" },
    icon: Activity,
    admin: true,
  },
  {
    href: "/evaluation",
    label: { en: "Evaluation", ar: "التقييم" },
    icon: BarChart3,
    admin: true,
  },
  {
    href: "/admin/subscriptions",
    label: { en: "Subscriptions", ar: "الاشتراكات" },
    icon: LayoutDashboard,
    admin: true,
  },
  {
    href: "/admin/users",
    label: { en: "Users", ar: "المستخدمون" },
    icon: Users,
    admin: true,
  },
  {
    href: "/audit",
    label: { en: "Audit trail", ar: "سجل التدقيق" },
    icon: ShieldCheck,
    admin: true,
  },
];

function Navigation({ close }: { close?: () => void }) {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const { theme, toggleTheme, isArabic, toggleLanguage } = useThemeLanguage();
  const router = useRouter();

  const renderItem = (item: NavigationItem) => {
    if (item.admin && user?.role !== "Admin") return null;
    const active =
      pathname === item.href ||
      (item.href !== "/studio" && pathname.startsWith(`${item.href}/`));
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={close}
        className={cn("app-nav-item", active && "app-nav-item-active")}
        aria-current={active ? "page" : undefined}
      >
        <Icon size={18} strokeWidth={1.8} aria-hidden />
        <span>{isArabic ? item.label.ar : item.label.en}</span>
      </Link>
    );
  };

  return (
    <div className="app-sidebar-content">
      <Link
        href="/"
        onClick={close}
        className="app-brand"
        aria-label={isArabic ? "الصفحة الرئيسية لدار ديزاين" : "DarDesign home"}
      >
        <span className="app-brand-mark" aria-hidden>
          DD
        </span>
        <span>
          <strong>DarDesign</strong>
          <small>
            {isArabic ? "ذكاء التصميم الداخلي" : "Interior intelligence"}
          </small>
        </span>
      </Link>

      <nav
        className="app-nav"
        aria-label={isArabic ? "التنقل الرئيسي" : "Main navigation"}
      >
        <p className="app-nav-label">
          {isArabic ? "مساحة العمل" : "Workspace"}
        </p>
        {mainNavigation.map(renderItem)}
        {user?.role === "Admin" && (
          <p className="app-nav-label app-nav-label-spaced">
            {isArabic ? "الإدارة" : "Administration"}
          </p>
        )}
        {adminNavigation.map(renderItem)}
      </nav>

      <div className="app-sidebar-footer">
        <div className="app-user-summary">
          <span className="app-avatar">
            {user?.fullName?.slice(0, 1).toUpperCase() ??
              (isArabic ? "ز" : "G")}
          </span>
          <span className="min-w-0">
            <strong>
              {user?.fullName ?? (isArabic ? "مساحة الضيف" : "Guest workspace")}
            </strong>
            <small>
              {user?.email ??
                (isArabic
                  ? "سجّل الدخول لحفظ التصاميم"
                  : "Sign in to save designs")}
            </small>
          </span>
        </div>
        <div className="app-sidebar-actions">
          <button
            className="app-icon-button"
            type="button"
            onClick={toggleTheme}
            title={
              theme === "light"
                ? isArabic
                  ? "التبديل إلى الوضع الداكن"
                  : "Switch to dark mode"
                : isArabic
                  ? "التبديل إلى الوضع الفاتح"
                  : "Switch to light mode"
            }
          >
            {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
          </button>
          <button
            className="app-icon-button app-language-button"
            type="button"
            onClick={toggleLanguage}
            title={isArabic ? "تغيير اللغة" : "Change language"}
          >
            {isArabic ? "EN" : "ع"}
          </button>
          {user ? (
            <button
              className="app-icon-button"
              type="button"
              title={isArabic ? "تسجيل الخروج" : "Log out"}
              onClick={async () => {
                await signOut();
                close?.();
                router.push("/");
              }}
            >
              <LogOut size={17} />
            </button>
          ) : (
            <Link
              className="app-icon-button"
              href="/login"
              onClick={close}
              title={isArabic ? "تسجيل الدخول" : "Sign in"}
            >
              <LogIn size={17} />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const publicRoute = pathname === "/login" || pathname === "/register";

  if (publicRoute) return <>{children}</>;

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Navigation />
      </aside>
      <div className="app-main">
        <header className="app-mobile-bar">
          <Link href="/" className="app-mobile-brand">
            DarDesign
          </Link>
          <button
            className="app-icon-button"
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>
        </header>
        <main className="app-content">{children}</main>
      </div>
      {open && (
        <button
          className="app-drawer-backdrop"
          type="button"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        className={cn("app-drawer", open && "app-drawer-open")}
        aria-label="Mobile navigation"
      >
        <button
          className="app-drawer-close app-icon-button"
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close navigation"
        >
          <X size={20} />
        </button>
        <Navigation close={() => setOpen(false)} />
      </aside>
    </div>
  );
}
