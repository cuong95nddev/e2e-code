import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const port = Number(process.env.PORT ?? 5733);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    "import.meta.env.VITE_WS_URL": JSON.stringify(process.env.VITE_WS_URL ?? ""),
  },
  server: {
    port,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
