import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import baseConfigFactory from "../../vite.config.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const virtualEntryId = "\0drum-notation-font-experiment:vexflow-core";

const fontSources = [
  {
    family: "Bravura",
    exportName: "Bravura",
    fileName: "Bravura.woff2",
    modulePath: "node_modules/vexflow/build/esm/src/fonts/bravura.js",
    descriptors: { display: "block" }
  },
  {
    family: "Academico",
    exportName: "Academico",
    fileName: "Academico.woff2",
    modulePath: "node_modules/vexflow/build/esm/src/fonts/academico.js",
    descriptors: { display: "swap" }
  },
  {
    family: "Academico",
    exportName: "AcademicoBold",
    fileName: "Academico-Bold.woff2",
    modulePath: "node_modules/vexflow/build/esm/src/fonts/academicobold.js",
    descriptors: { display: "swap", weight: "bold" }
  }
];

function readBundledFont({ exportName, modulePath }) {
  const source = readFileSync(path.join(projectRoot, modulePath), "utf8");
  const marker = `export const ${exportName} = 'data:font/woff2;charset=utf-8;base64,`;
  const start = source.indexOf(marker);
  const end = start < 0 ? -1 : source.indexOf("';", start + marker.length);

  if (start < 0 || end < 0) {
    throw new Error(`Could not extract ${exportName} from ${modulePath}.`);
  }

  return Buffer.from(source.slice(start + marker.length, end), "base64");
}

function externalNotationFonts() {
  let emittedFonts = [];

  return {
    name: "external-notation-font-experiment",
    enforce: "pre",
    buildStart() {
      emittedFonts = fontSources.map((font) => ({
        ...font,
        referenceId: this.emitFile({
          type: "asset",
          name: font.fileName,
          source: readBundledFont(font)
        })
      }));
    },
    resolveId(source) {
      if (source === "vexflow/bravura") {
        return virtualEntryId;
      }
      return null;
    },
    load(id) {
      if (id !== virtualEntryId) {
        return null;
      }

      const loads = emittedFonts.map((font) => {
        const url = `import.meta.ROLLUP_FILE_URL_${font.referenceId}`;
        return `Font.load(${JSON.stringify(font.family)}, ${url}, ${JSON.stringify(font.descriptors)})`;
      });

      return [
        'import VexFlow, { Font } from "vexflow/core";',
        'VexFlow.BUILD.INFO = "vexflow-core-external-font-experiment";',
        'VexFlow.setFonts("Bravura", "Academico");',
        `export const notationFontsReady = Promise.allSettled([${loads.join(",")}]);`,
        'export * from "vexflow/core";',
        "export default VexFlow;"
      ].join("\n");
    }
  };
}

export default defineConfig(async (environment) => {
  const baseConfig = typeof baseConfigFactory === "function"
    ? await baseConfigFactory(environment)
    : baseConfigFactory;

  return mergeConfig(baseConfig, {
    plugins: [externalNotationFonts()]
  });
});
