"use client";

/* ============================================================
   Chrome — top bar (mark + utility toggles + account/admin nav)

   Information architecture:
     left    — wordmark (home)
     right   — utility toggles (audio / theme / language)
             — primary destinations (History, Others' Work)
             — an Account menu that collects Subscription, the three
               admin destinations, and Log out
     <900px  — everything collapses into a single sheet behind one button

   A signed-in admin previously got ten flat pills in one row with no
   overflow handling, no active-route state, and no mobile treatment;
   Arabic labels are longer, so RTL was worse. Every destination that
   existed before is still reachable, now in at most one interaction.
   ============================================================ */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useThemeLanguage } from "@/context/ThemeLanguageContext";
import { useCinemaCopy } from "@/components/cinema/copy";
import { DarAudio } from "@/lib/audio";

interface CinemaChromeProps {
  onNavHome?: () => void;
}

export default function CinemaChrome({ onNavHome }: CinemaChromeProps) {
  const { isArabic, theme, toggleLanguage, toggleTheme } = useThemeLanguage();
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [audioOn, setAudioOn] = useState<boolean>(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const accountRef = useRef<HTMLDivElement>(null);
  const mobileRef = useRef<HTMLDivElement>(null);

  const t = useCinemaCopy().chrome;
  const isAr = isArabic;

  const isActive = useCallback(
    (href: string) => pathname === href || pathname.startsWith(`${href}/`),
    [pathname]
  );

  // Close both overlays on route change — otherwise the sheet stays open
  // over the page you just navigated to.
  useEffect(() => {
    setAccountOpen(false);
    setMobileOpen(false);
  }, [pathname]);

  // Escape closes whichever overlay is open; click-outside closes it too.
  useEffect(() => {
    if (!accountOpen && !mobileOpen) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAccountOpen(false);
        setMobileOpen(false);
      }
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (accountOpen && accountRef.current && !accountRef.current.contains(target)) {
        setAccountOpen(false);
      }
      if (mobileOpen && mobileRef.current && !mobileRef.current.contains(target)) {
        setMobileOpen(false);
      }
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [accountOpen, mobileOpen]);

  const handleSignOut = useCallback(async () => {
    setAccountOpen(false);
    setMobileOpen(false);
    await signOut();
    router.push("/");
  }, [router, signOut]);

  const isAdmin = user?.role === "Admin";

  const labels = {
    history: isAr ? "سجلّي" : "History",
    others: isAr ? "أعمال الآخرين" : "Others' Work",
    subscription: isAr ? "الاشتراك" : "Subscription",
    dashboard: isAr ? "لوحة التحكم" : "Dashboard",
    manageSubs: isAr ? "إدارة الاشتراكات" : "Manage Subscriptions",
    users: isAr ? "المستخدمون" : "Users",
    logout: isAr ? "خروج" : "Log out",
    signIn: isAr ? "دخول" : "Sign in",
    account: isAr ? "الحساب" : "Account",
    adminGroup: isAr ? "الإدارة" : "Admin",
    menu: isAr ? "القائمة" : "Menu",
  };

  const audioButton = (
    <button
      className="toggle"
      onClick={() => setAudioOn(DarAudio.toggle())}
      title={t.audioOn}
      aria-pressed={audioOn}
      aria-label={t.audioOn}
    >
      <span className="audio-pulse">
        {audioOn ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M3 10v4M7 6v12M11 3v18M15 6v12M19 10v4" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M3 12h4M9 12h2M14 12h2M19 12h2" strokeLinecap="round" />
          </svg>
        )}
        {audioOn ? "♪" : "·"}
      </span>
    </button>
  );

  const themeButton = (
    <button
      className="toggle"
      onClick={() => toggleTheme()}
      title={theme === "dark" ? t.themeLight : t.themeDark}
      aria-label={theme === "dark" ? t.themeLight : t.themeDark}
    >
      {theme === "dark" ? "◐" : "◑"} {theme === "dark" ? t.themeLight : t.themeDark}
    </button>
  );

  const languageButton = (
    <button className="toggle" onClick={() => toggleLanguage()} lang={isAr ? "en" : "ar"}>
      {t.langToggle}
    </button>
  );

  /* Destinations shared by the desktop account menu and the mobile sheet. */
  const accountLinks = (
    <>
      <Link
        className="chrome-item"
        href="/subscription"
        aria-current={isActive("/subscription") ? "page" : undefined}
      >
        {labels.subscription}
      </Link>

      {/* Admins only. Hiding these is a convenience, not the control: every
          /api/admin/* endpoint checks the role server-side, so typing the URL
          as an ordinary user still gets a 403. */}
      {isAdmin && (
        <>
          <span className="chrome-group-label">{labels.adminGroup}</span>
          <Link
            className="chrome-item"
            href="/evaluation"
            aria-current={isActive("/evaluation") ? "page" : undefined}
          >
            {labels.dashboard}
          </Link>
          <Link
            className="chrome-item"
            href="/admin/subscriptions"
            aria-current={isActive("/admin/subscriptions") ? "page" : undefined}
          >
            {labels.manageSubs}
          </Link>
          <Link
            className="chrome-item"
            href="/admin/users"
            aria-current={isActive("/admin/users") ? "page" : undefined}
          >
            {labels.users}
          </Link>
        </>
      )}

      <button className="chrome-item chrome-item-danger" onClick={handleSignOut}>
        {labels.logout}
      </button>
    </>
  );

  return (
    <header className="chrome">
      <button
        className="mark"
        onClick={onNavHome}
        aria-label="DarDesign — home"
        style={{ background: "transparent" }}
      >
        {isAr ? (
          <span>
            دار<span className="dot"></span>ديزاين
          </span>
        ) : (
          <span>
            Dar<span className="dot"></span>Design
          </span>
        )}
      </button>

      {/* ---------------- desktop ---------------- */}
      <div className="group chrome-wide">
        {audioButton}
        {themeButton}
        {languageButton}

        {!loading &&
          (user ? (
            <>
              <Link
                className="toggle"
                href="/history"
                aria-current={isActive("/history") ? "page" : undefined}
              >
                {labels.history}
              </Link>
              <Link
                className="toggle"
                href="/others"
                aria-current={isActive("/others") ? "page" : undefined}
              >
                {labels.others}
              </Link>

              <div className="chrome-menu" ref={accountRef}>
                <button
                  className="toggle chrome-menu-trigger"
                  onClick={() => setAccountOpen((o) => !o)}
                  aria-expanded={accountOpen}
                  aria-haspopup="menu"
                  title={user.email}
                >
                  {labels.account}
                  <span className="chrome-caret" aria-hidden="true">
                    ▾
                  </span>
                </button>
                {accountOpen && (
                  <div className="chrome-menu-panel" role="menu" dir={isAr ? "rtl" : "ltr"}>
                    <span className="chrome-menu-email" title={user.email}>
                      {user.email}
                    </span>
                    {accountLinks}
                  </div>
                )}
              </div>
            </>
          ) : (
            <Link
              className="toggle"
              href="/login"
              aria-current={isActive("/login") ? "page" : undefined}
            >
              {labels.signIn}
            </Link>
          ))}
      </div>

      {/* ---------------- mobile / narrow ---------------- */}
      <div className="group chrome-narrow" ref={mobileRef}>
        {themeButton}
        <button
          className="toggle chrome-burger"
          onClick={() => setMobileOpen((o) => !o)}
          aria-expanded={mobileOpen}
          aria-haspopup="menu"
          aria-label={labels.menu}
        >
          <span className="chrome-burger-bars" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </button>

        {mobileOpen && (
          <div className="chrome-sheet" role="menu" dir={isAr ? "rtl" : "ltr"}>
            <div className="chrome-sheet-row">
              {audioButton}
              {languageButton}
            </div>

            {!loading &&
              (user ? (
                <>
                  <Link
                    className="chrome-item"
                    href="/history"
                    aria-current={isActive("/history") ? "page" : undefined}
                  >
                    {labels.history}
                  </Link>
                  <Link
                    className="chrome-item"
                    href="/others"
                    aria-current={isActive("/others") ? "page" : undefined}
                  >
                    {labels.others}
                  </Link>
                  <span className="chrome-menu-email" title={user.email}>
                    {user.email}
                  </span>
                  {accountLinks}
                </>
              ) : (
                <Link
                  className="chrome-item"
                  href="/login"
                  aria-current={isActive("/login") ? "page" : undefined}
                >
                  {labels.signIn}
                </Link>
              ))}
          </div>
        )}
      </div>
    </header>
  );
}
