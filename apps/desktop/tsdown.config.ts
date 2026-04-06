import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["src/main.ts"],
    format: "cjs",
    outDir: "dist-electron",
    clean: true,
    external: ["electron"],
  },
  {
    entry: ["src/preload.ts"],
    format: "cjs",
    outDir: "dist-electron",
    external: ["electron"],
  },
]);
