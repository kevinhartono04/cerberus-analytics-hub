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
        ink: "#dae2fd",
        line: "#424656",
        mist: "#050b18",
        sage: "#1a2235",
        gold: "#ffb95f",
        cobalt: "#0066ff",
        surface: "#050b18",
        "surface-low": "#0b1324",
        "surface-mid": "#101827",
        "surface-high": "#1a2235",
        "surface-highest": "#242c40",
        "text-muted": "#c2c6d8",
        emerald: "#4edea3",
        amber: "#ffb95f",
        cyan: "#48d9ff",
        violet: "#b7a4ff",
        rose: "#ff7a90",
      },
      boxShadow: {
        soft: "0 0 0 1px rgba(179, 197, 255, 0.03), 0 14px 30px rgba(0, 0, 0, 0.2)"
      }
    },
  },
  plugins: [],
};

export default config;
