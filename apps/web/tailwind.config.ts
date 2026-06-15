import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "var(--bg)",
          1: "var(--bg-1)",
          2: "var(--bg-2)",
          3: "var(--bg-3)",
          hover: "var(--bg-hover)",
        },
        line: {
          DEFAULT: "var(--line)",
          2: "var(--line-2)",
          3: "var(--line-3)",
        },
        text: {
          DEFAULT: "var(--text)",
          2: "var(--text-2)",
        },
        muted: "var(--muted)",
        dim: "var(--dim)",
        faint: "var(--faint)",
        white: "var(--white)",
        accent: "var(--accent)",
        // Legacy tokens kept for the shared button primitive and any untouched bits.
        border: "var(--line)",
        background: "var(--bg)",
        foreground: "var(--text)",
        primary: {
          DEFAULT: "var(--white)",
          foreground: "#0a0a0a",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "-apple-system", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
