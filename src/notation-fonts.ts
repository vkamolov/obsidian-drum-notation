import { Academico } from "vexflow-fonts/academico";
import { AcademicoBold } from "vexflow-fonts/academicobold";
import { Bravura } from "vexflow-fonts/bravura";

// VexFlow registers its music fonts through the FontFace API in the document
// that loaded the plugin. Obsidian renders PDF exports and pop-out windows in
// separate documents where those registrations do not exist, so rendered SVG
// glyph text falls back to missing-glyph boxes there. Injecting equivalent
// CSS @font-face rules into each rendering document keeps the bundled fonts
// available everywhere a drums block renders, including Chromium's print
// pipeline. The data URLs are the same modules the vexflow/bravura entry
// bundles, so this adds no size to the plugin build.

const FONT_STYLE_ATTR = "data-drum-notation-fonts";

const FONT_FACE_CSS = [
  fontFaceRule("Bravura", Bravura, "block"),
  fontFaceRule("Academico", Academico, "swap"),
  fontFaceRule("Academico", AcademicoBold, "swap", "bold")
].join("\n");

const FONT_LOAD_DESCRIPTORS = ["30pt Bravura", "30pt Academico", "bold 30pt Academico"];

const ensuredDocuments = new WeakSet<Document>();

export async function ensureNotationFontsInDocument(doc: Document): Promise<void> {
  if (ensuredDocuments.has(doc)) {
    return;
  }

  if (!doc.head.querySelector(`style[${FONT_STYLE_ATTR}]`)) {
    const style = doc.createElement("style");

    style.setAttribute(FONT_STYLE_ATTR, "");
    style.textContent = FONT_FACE_CSS;
    doc.head.appendChild(style);
  }

  for (const descriptor of FONT_LOAD_DESCRIPTORS) {
    try {
      await doc.fonts.load(descriptor);
    } catch {
      // Unavailable fonts must never block score rendering; the SVG still
      // renders and the browser swaps glyphs in if the fonts load later.
    }
  }

  ensuredDocuments.add(doc);
}

function fontFaceRule(family: string, source: string, display: string, weight?: string): string {
  const weightPart = weight ? ` font-weight: ${weight};` : "";

  return `@font-face { font-family: "${family}"; src: url("${source}") format("woff2"); font-display: ${display};${weightPart} }`;
}
