/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0e14",
        panel: "#0f1420",
        card: "#141a24",
        border: "#232b3a",
        muted: "#8b93a7",
        accent: "#22d3ee",
        accent2: "#0891b2",
        good: "#34d399",
        warn: "#fbbf24",
        bad: "#f87171",
        purple: "#a78bfa",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
}
