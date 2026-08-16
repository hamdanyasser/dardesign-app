import Script from "next/script";
import type { Metadata, Viewport } from "next";
import {
  Amiri,
  Cormorant_Garamond,
  DM_Sans,
  Inter,
  JetBrains_Mono,
  Noto_Kufi_Arabic,
  Reem_Kufi,
  Tajawal,
} from "next/font/google";
import "./globals.css";
import "@/components/cinema/cinema.css";
import "@/components/dar/dar-cinema.css";
import AppShell from "@/components/AppShell";
import { AuthProvider } from "@/context/AuthContext";
import { ImageProvider } from "@/context/ImageContext";
import { ThemeLanguageProvider } from "@/context/ThemeLanguageContext";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const cormorantGaramond = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-cormorant",
  display: "swap",
});

const notoKufiArabic = Noto_Kufi_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "700"],
  variable: "--font-noto-kufi-arabic",
  display: "swap",
});

const tajawal = Tajawal({
  subsets: ["arabic"],
  weight: ["400", "500", "700", "800"],
  variable: "--font-tajawal",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-dm-sans",
  display: "swap",
});

// Cinematic display + UI faces (dar-design-2): editorial Arabic serif,
// Kufi display, and the mono used for eyebrows / chrome labels.
const amiri = Amiri({
  subsets: ["arabic", "latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  variable: "--font-amiri",
  display: "swap",
});

const reemKufi = Reem_Kufi({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-reem-kufi",
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://dardesign.app"),
  title: {
    default: "DarDesign — AI interior design inspired by Arabic architecture",
    template: "%s · DarDesign",
  },
  description:
    "Upload a room and see it reimagined in Lebanese, Khaleeji, or Moroccan style — an AI redesign in minutes.",
  applicationName: "DarDesign",
  keywords: [
    "interior design",
    "AI interior design",
    "Arabic architecture",
    "Lebanese",
    "Khaleeji",
    "Moroccan",
    "تصميم داخلي",
    "دار ديزاين",
  ],
  authors: [{ name: "Yasser" }, { name: "Zainab" }],
  openGraph: {
    title: "DarDesign — AI interior design inspired by Arabic architecture",
    description:
      "Upload a room and see it reimagined in Lebanese, Khaleeji, and Moroccan styles.",
    siteName: "DarDesign",
    type: "website",
  },
};

export const viewport: Viewport = {
  // These tint browser chrome only, but they are the one place a stale palette
  // survives silently. Both now match --dd-bg exactly: the dark value follows
  // the limestone-at-night repalette, and the light one closes the #faf8f5 vs
  // #f7f0e4 drift CLAUDE.md had flagged as the last of the old cream.
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0e1d37" },
    { media: "(prefers-color-scheme: light)", color: "#f7f0e4" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      dir="ltr"
      data-theme="light"
      className={`${inter.variable} ${notoKufiArabic.variable} ${tajawal.variable} ${dmSans.variable} ${cormorantGaramond.variable} ${amiri.variable} ${reemKufi.variable} ${jetBrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased">
        {/* Runs before the app paints: restores the saved theme/language so there
            is no flash of the wrong theme. Falls back to the OS colour preference.
            Storage keys must stay in sync with ThemeLanguageContext. */}
        <Script
          id="theme-language-restore"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            /* Unset falls to LIGHT, not to the OS preference. This is presented
               from a projector: a demo machine that happens to sit in dark mode
               would otherwise throw the whole app into the theme a beam handles
               worst, on the one occasion it matters. An explicit choice still
               wins and still persists. */
            __html: `(function(){try{var h=document.documentElement;var t=localStorage.getItem('dd-theme');if(t!=='dark'&&t!=='light'){t='light';}var l=localStorage.getItem('dd-language');if(l!=='en'&&l!=='ar'){l='en';}h.setAttribute('data-theme',t);h.setAttribute('lang',l);h.setAttribute('dir',l==='ar'?'rtl':'ltr');}catch(e){}})();`,
          }}
        />
        <ThemeLanguageProvider>
          <AuthProvider>
            <ImageProvider>
              <AppShell>{children}</AppShell>
            </ImageProvider>
          </AuthProvider>
        </ThemeLanguageProvider>
      </body>
    </html>
  );
}
