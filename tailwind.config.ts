import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        charcoal: {
          DEFAULT: "var(--charcoal)",
          soft: "var(--charcoal-soft)",
          hover: "var(--charcoal-hover)",
        },
        gold: {
          DEFAULT: "var(--gold)",
          light: "var(--gold-light)",
          dim: "var(--gold-dim)",
        },
        cream: {
          DEFAULT: "var(--cream)",
          soft: "var(--cream-soft)",
          muted: "var(--cream-muted)",
        },
        error: "var(--error)",
        success: "var(--success)",
      },
      fontFamily: {
        tajawal: ["var(--font-tajawal)", "sans-serif"],
        "dm-sans": ["var(--font-dm-sans)", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
