import { Academico } from "vexflow-fonts/academico";
import { AcademicoBold } from "vexflow-fonts/academicobold";
import { Bravura } from "vexflow-fonts/bravura";
import { DocumentFontDefinition, DocumentFontRegistry } from "./document-fonts";

// VexFlow registers its music fonts through the FontFace API in the document
// that loaded the plugin. Obsidian renders PDF exports and pop-out windows in
// separate documents where those registrations do not exist, so rendered SVG
// glyph text falls back to missing-glyph boxes there. Registering the bundled
// font faces with each rendering document keeps the fonts available everywhere
// a drums block renders, including Chromium's print pipeline, without injecting
// runtime style elements. The data URLs are the same modules the
// vexflow/bravura entry bundles, so this adds no size to the plugin build.

const NOTATION_FONTS: readonly DocumentFontDefinition[] = [
  {
    family: "Bravura",
    source: Bravura,
    descriptors: { display: "block" }
  },
  {
    family: "Academico",
    source: Academico,
    descriptors: { display: "swap" }
  },
  {
    family: "Academico",
    source: AcademicoBold,
    descriptors: { display: "swap", weight: "bold" }
  }
];

const notationFontRegistry = new DocumentFontRegistry();

export function ensureNotationFontsInDocument(doc: Document): Promise<void> {
  return notationFontRegistry.ensure(doc, NOTATION_FONTS);
}
