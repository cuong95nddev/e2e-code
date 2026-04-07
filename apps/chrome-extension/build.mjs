import * as esbuild from "esbuild";
import * as fs from "node:fs";

const watch = process.argv.includes("--watch");

const entryPoints = [
  { in: "src/content-script.ts", out: "content-script" },
  { in: "src/background.ts",     out: "background" },
  { in: "src/popup.ts",          out: "popup" },
];

const ctx = await esbuild.context({
  entryPoints,
  bundle: true,
  outdir: "dist",
  format: "iife",
  target: "chrome120",
  sourcemap: watch ? "inline" : false,
});

if (watch) {
  await ctx.watch();
  console.log("Watching...");
} else {
  await ctx.rebuild();
  ctx.dispose();

  // Copy static files to dist/
  fs.copyFileSync("manifest.json", "dist/manifest.json");
  fs.copyFileSync("popup.html",    "dist/popup.html");

  // Copy icons if present
  if (fs.existsSync("icons")) {
    fs.mkdirSync("dist/icons", { recursive: true });
    for (const f of fs.readdirSync("icons")) {
      fs.copyFileSync(`icons/${f}`, `dist/icons/${f}`);
    }
  }
  console.log("Build complete → dist/");
}
