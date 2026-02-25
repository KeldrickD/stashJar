import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        sj: {
          bg: "#F5FBF8",
          surface: "#FFFFFF",
          glass: "rgba(255,255,255,0.72)",
          border: "rgba(214, 233, 224, 0.9)",
          text: {
            primary: "#0B1220",
            muted: "#5B6B64",
            faint: "#8A9A93",
          },
          mint: {
            50: "#E9FBF3",
            100: "#D3F6E7",
            500: "#18A874",
            600: "#149062",
            700: "#0E6D4A",
          },
          gold: {
            100: "#FFF3D6",
            500: "#F5C04E",
            600: "#D9A437",
          },
          baseBlue: "#2F6BFF",
        },
      },
      boxShadow: {
        sjCard: "0 18px 40px rgba(11, 18, 32, 0.08)",
        sjCardSoft: "0 10px 24px rgba(11, 18, 32, 0.06)",
        sjGlowMint: "0 18px 40px rgba(24, 168, 116, 0.14)",
        sjGlowBlue: "0 18px 40px rgba(47, 107, 255, 0.10)",
      },
      borderRadius: {
        sj: "20px",
        sjLg: "24px",
        sjPill: "999px",
      },
      backdropBlur: {
        sj: "16px",
      },
      keyframes: {
        "sj-fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "sj-pop": {
          "0%": { transform: "scale(0.985)" },
          "100%": { transform: "scale(1)" },
        },
        "sj-pulse-soft": {
          "0%, 100%": { boxShadow: "0 0 0 rgba(24,168,116,0)" },
          "50%": { boxShadow: "0 0 0 10px rgba(24,168,116,0.10)" },
        },
        "sj-count": {
          "0%": { transform: "translateY(2px)", opacity: "0.85" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
      animation: {
        "sj-fade-up": "sj-fade-up 240ms ease-out both",
        "sj-pop": "sj-pop 160ms ease-out both",
        "sj-pulse-soft": "sj-pulse-soft 900ms ease-in-out both",
        "sj-count": "sj-count 220ms ease-out both",
      },
    },
  },
};

export default config;
