import type { Metadata } from "next";
import { Cormorant_Garamond, DM_Sans, Inter, Noto_Kufi_Arabic, Tajawal } from "next/font/google";
import "./globals.css";
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

export const metadata: Metadata = {
  title: "DarDesign — AI interior design inspired by Arabic architecture",
  description:
    "Upload a room, choose Lebanese, Khaleeji, or Moroccan style, and see an AI-powered transformation in seconds.",
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
      data-theme="dark"
      className={`${inter.variable} ${notoKufiArabic.variable} ${tajawal.variable} ${dmSans.variable} ${cormorantGaramond.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <ThemeLanguageProvider>
          <ImageProvider>{children}</ImageProvider>
        </ThemeLanguageProvider>
      </body>
    </html>
  );
}
