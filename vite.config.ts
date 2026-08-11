import { defineConfig } from "vite";
import { createLicenseBanner } from "./tools/license-banner.mjs";
import { getNotationCoreInfoSync } from "./tools/notation-digest.mjs";

const licenseBanner = createLicenseBanner("Obsidian Drum Notation web playground");
const productionCsp = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'none'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join("; ");

// The playground lives in web/ but imports the shared core and renderer straight
// from ../src — one source of truth, no package split. base: "./" keeps asset
// paths relative so the built site works from a subpath (e.g. GitHub Pages).
export default defineConfig(() => {
  const notationCore = getNotationCoreInfoSync();

  return {
    root: "web",
    base: "./",
    define: {
      __NOTATION_CORE_VERSION__: JSON.stringify(notationCore.version),
      __NOTATION_CORE_DIGEST__: JSON.stringify(notationCore.digest)
    },
    plugins: [
      {
        name: "production-meta-csp",
        apply: "build",
        transformIndexHtml() {
          return [
            {
              tag: "meta",
              attrs: {
                "http-equiv": "Content-Security-Policy",
                content: productionCsp
              },
              injectTo: "head-prepend"
            },
            {
              tag: "meta",
              attrs: {
                name: "drum-notation-core-version",
                content: notationCore.version
              },
              injectTo: "head"
            },
            {
              tag: "meta",
              attrs: {
                name: "drum-notation-core-digest",
                content: notationCore.digest
              },
              injectTo: "head"
            }
          ];
        }
      }
    ],
    server: {
      // Allow importing modules from the repo root (../src) while rooted in web/.
      fs: { allow: [".."] },
      // Honor a PORT assigned by the tooling (e.g. the preview harness); falls back
      // to Vite's default (5173) when unset.
      port: process.env.PORT ? Number(process.env.PORT) : undefined
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: {
        output: {
          banner: licenseBanner
        }
      }
    }
  };
});
