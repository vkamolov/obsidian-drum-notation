export interface DocumentFontDefinition {
  family: string;
  source: string;
  descriptors: FontFaceDescriptors;
}

type FontFaceConstructor = new (
  family: string,
  source: string | BufferSource,
  descriptors?: FontFaceDescriptors
) => FontFace;

interface FontFaceWindow extends Window {
  FontFace?: FontFaceConstructor;
}

interface WritableFontFaceSet extends FontFaceSet {
  add(font: FontFace): this;
}

export class DocumentFontRegistry {
  private readonly documentPromises = new WeakMap<Document, Promise<void>>();

  ensure(doc: Document, definitions: readonly DocumentFontDefinition[]): Promise<void> {
    const existingPromise = this.documentPromises.get(doc);

    if (existingPromise) {
      return existingPromise;
    }

    const fontPromise = this.register(doc, definitions);
    this.documentPromises.set(doc, fontPromise);

    return fontPromise;
  }

  private async register(
    doc: Document,
    definitions: readonly DocumentFontDefinition[]
  ): Promise<void> {
    const fontFaceConstructor = getFontFaceConstructor(doc);
    const fontSet = doc.fonts;

    if (!fontFaceConstructor || !isWritableFontFaceSet(fontSet)) {
      return;
    }

    await Promise.all(
      definitions.map(async ({ family, source, descriptors }) => {
        try {
          const fontFace = new fontFaceConstructor(
            family,
            `url("${source}") format("woff2")`,
            descriptors
          );

          fontSet.add(fontFace);
          await fontFace.load();
        } catch {
          // Font loading must never block score rendering. VexFlow can still
          // render and the browser may fall back to an existing face.
        }
      })
    );
  }
}

function isWritableFontFaceSet(fontSet: FontFaceSet): fontSet is WritableFontFaceSet {
  return "add" in fontSet && typeof fontSet.add === "function";
}

function getFontFaceConstructor(doc: Document): FontFaceConstructor | null {
  const documentWindow = doc.defaultView as FontFaceWindow | null;

  if (documentWindow?.FontFace) {
    return documentWindow.FontFace;
  }

  return typeof FontFace === "undefined" ? null : FontFace;
}
