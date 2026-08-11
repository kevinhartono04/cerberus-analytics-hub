import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Hanken Grotesk", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        brand: ["Sora", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        ink: "rgb(var(--color-ink) / <alpha-value>)",
        line: "rgb(var(--color-line) / <alpha-value>)",
        mist: "rgb(var(--color-mist) / <alpha-value>)",
        sage: "rgb(var(--color-sage) / <alpha-value>)",
        gold: "rgb(var(--color-gold) / <alpha-value>)",
        cobalt: "#6d5ef7",
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        "surface-low": "rgb(var(--color-surface-low) / <alpha-value>)",
        "surface-mid": "rgb(var(--color-surface-mid) / <alpha-value>)",
        "surface-high": "rgb(var(--color-surface-high) / <alpha-value>)",
        "surface-highest": "rgb(var(--color-surface-highest) / <alpha-value>)",
        "surface-panel": "rgb(var(--color-surface-panel) / <alpha-value>)",
        "surface-card": "rgb(var(--color-surface-card) / <alpha-value>)",
        "surface-table": "rgb(var(--color-surface-table) / <alpha-value>)",
        "surface-raised": "rgb(var(--color-surface-raised) / <alpha-value>)",
        "surface-popover": "rgb(var(--color-surface-popover) / <alpha-value>)",
        "surface-hover": "rgb(var(--color-surface-hover) / <alpha-value>)",
        "text-muted": "rgb(var(--color-text-muted) / <alpha-value>)",
        "text-subtle": "rgb(var(--color-text-subtle) / <alpha-value>)",
        "brand-muted": "rgb(var(--color-brand-muted) / <alpha-value>)",
        emerald: "rgb(var(--color-emerald) / <alpha-value>)",
        amber: "rgb(var(--color-amber) / <alpha-value>)",
        cyan: "rgb(var(--color-cyan) / <alpha-value>)",
        violet: "rgb(var(--color-violet) / <alpha-value>)",
        rose: "rgb(var(--color-rose) / <alpha-value>)",
      },
      boxShadow: {
        soft: "0 0 0 1px rgba(179, 197, 255, 0.03), 0 14px 30px rgba(0, 0, 0, 0.2)"
      }
    },
  },
  plugins: [],
};

export default config;
