import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// HARE renderer build config.
// The renderer is a normal Vite + React SPA that runs inside the Electron
// BrowserWindow. In dev mode it's also just a regular web app, which is
// what lets us preview/screenshot it in a plain browser while building.
export default defineConfig({
  base: "./",
  // Tailwind v4 moved off the plain-PostCSS-plugin model to a first-party
  // Vite plugin (@tailwindcss/vite) for tighter build integration -- no
  // postcss.config.js needed anymore (removed; autoprefixer is also gone,
  // v4 handles vendor prefixing internally).
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      // import.meta.dirname (not __dirname) -- Vite 8 warns that __dirname
      // isn't supported once the native (Rolldown-based) config loader
      // becomes the default in a future major version.
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
