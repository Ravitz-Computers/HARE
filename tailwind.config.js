/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // HARE brand palette — "chaotic good demon bunny," kept clean and
        // minimal: near-black obsidian base (dark theme) or soft off-white
        // (light theme), one hot imp-pink accent, one violet for the
        // mischief, everything else quiet and out of the way. Each "hare-*"
        // token resolves to a CSS variable (see src/index.css's :root/.dark
        // blocks) instead of a fixed hex, so light/dark mode is a single
        // class toggle on <html> — no component ever needs its own light/
        // dark variant classes. Accent colors below stay constant across
        // both themes on purpose, same as most brand-driven apps.
        hare: {
          bg: "var(--hare-bg)",
          panel: "var(--hare-panel)",
          panel2: "var(--hare-panel2)",
          border: "var(--hare-border)",
          text: "var(--hare-text)",
          muted: "var(--hare-muted)",
        },
        glow: {
          pink: "#ff2e7a",
          violet: "#8b3ffb",
          cyan: "#22d3ee",
          amber: "#ffb457",
          rose: "#ff4d6d",
          green: "#3ddc97",
        },
      },
      fontFamily: {
        display: ["'Space Grotesk'", "Inter", "system-ui", "sans-serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 24px -4px rgba(255, 46, 122, 0.5)",
        "glow-violet": "0 0 24px -4px rgba(139, 63, 251, 0.5)",
        card: "0 8px 30px -12px rgba(0,0,0,0.6)",
      },
      backgroundImage: {
        "hare-gradient":
          "radial-gradient(circle at 20% -10%, rgba(139,63,251,0.22), transparent 40%), radial-gradient(circle at 100% 0%, rgba(255,46,122,0.16), transparent 45%)",
        "brand-gradient": "linear-gradient(135deg, #ff2e7a 0%, #8b3ffb 100%)",
      },
      keyframes: {
        pulseGlow: {
          "0%, 100%": { opacity: 1 },
          "50%": { opacity: 0.55 },
        },
        shimmer: {
          "0%": { backgroundPosition: "0% 50%" },
          "100%": { backgroundPosition: "200% 50%" },
        },
      },
      animation: {
        pulseGlow: "pulseGlow 2.2s ease-in-out infinite",
        shimmer: "shimmer 3s linear infinite",
      },
    },
  },
  plugins: [],
};
