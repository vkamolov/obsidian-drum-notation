import { defineConfig } from "vite";

// The playground lives in web/ but imports the shared core and renderer straight
// from ../src — one source of truth, no package split. base: "./" keeps asset
// paths relative so the built site works from a subpath (e.g. GitHub Pages).
export default defineConfig({
  root: "web",
  base: "./",
  server: {
    // Allow importing modules from the repo root (../src) while rooted in web/.
    fs: { allow: [".."] },
    // Honor a PORT assigned by the tooling (e.g. the preview harness); falls back
    // to Vite's default (5173) when unset.
    port: process.env.PORT ? Number(process.env.PORT) : undefined
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
