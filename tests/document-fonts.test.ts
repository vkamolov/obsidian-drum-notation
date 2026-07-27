import { describe, expect, it, vi } from "vitest";
import {
  DocumentFontDefinition,
  DocumentFontRegistry
} from "../src/document-fonts";

const FONT_DEFINITIONS: readonly DocumentFontDefinition[] = [
  {
    family: "Bravura",
    source: "data:font/woff2;base64,bravura",
    descriptors: { display: "block" }
  },
  {
    family: "Academico",
    source: "data:font/woff2;base64,academico",
    descriptors: { display: "swap" }
  },
  {
    family: "Academico",
    source: "data:font/woff2;base64,academico-bold",
    descriptors: { display: "swap", weight: "bold" }
  }
];

interface CapturedFontFace {
  family: string;
  source: string | BufferSource;
  descriptors: FontFaceDescriptors;
  loadCalls: number;
}

interface FontDocumentHarness {
  doc: Document;
  faces: CapturedFontFace[];
  add: ReturnType<typeof vi.fn>;
}

interface FontDocumentOptions {
  failLoadAt?: ReadonlySet<number>;
  loadGate?: Promise<void>;
}

function createFontDocument(options: FontDocumentOptions = {}): FontDocumentHarness {
  const faces: CapturedFontFace[] = [];
  const addedFaces: FontFace[] = [];
  const add = vi.fn((font: FontFace) => {
    addedFaces.push(font);
  });

  class TestFontFace {
    private readonly captured: CapturedFontFace;
    private readonly index: number;

    constructor(
      family: string,
      source: string | BufferSource,
      descriptors: FontFaceDescriptors = {}
    ) {
      this.index = faces.length;
      this.captured = {
        family,
        source,
        descriptors,
        loadCalls: 0
      };
      faces.push(this.captured);
    }

    async load(): Promise<FontFace> {
      this.captured.loadCalls += 1;

      if (options.loadGate) {
        await options.loadGate;
      }

      if (options.failLoadAt?.has(this.index)) {
        throw new Error("Font load failed");
      }

      return this as unknown as FontFace;
    }
  }

  const doc = {
    defaultView: { FontFace: TestFontFace },
    fonts: { add }
  } as unknown as Document;

  return { doc, faces, add };
}

describe("document font registration", () => {
  it("registers and loads every configured font face", async () => {
    const registry = new DocumentFontRegistry();
    const harness = createFontDocument();

    await registry.ensure(harness.doc, FONT_DEFINITIONS);

    expect(harness.faces).toEqual([
      {
        family: "Bravura",
        source: 'url("data:font/woff2;base64,bravura") format("woff2")',
        descriptors: { display: "block" },
        loadCalls: 1
      },
      {
        family: "Academico",
        source: 'url("data:font/woff2;base64,academico") format("woff2")',
        descriptors: { display: "swap" },
        loadCalls: 1
      },
      {
        family: "Academico",
        source: 'url("data:font/woff2;base64,academico-bold") format("woff2")',
        descriptors: { display: "swap", weight: "bold" },
        loadCalls: 1
      }
    ]);
    expect(harness.add).toHaveBeenCalledTimes(3);
  });

  it("shares one in-flight registration per document", async () => {
    let releaseLoads: (() => void) | undefined;
    const loadGate = new Promise<void>((resolve) => {
      releaseLoads = resolve;
    });
    const registry = new DocumentFontRegistry();
    const harness = createFontDocument({ loadGate });

    const first = registry.ensure(harness.doc, FONT_DEFINITIONS);
    const second = registry.ensure(harness.doc, FONT_DEFINITIONS);

    expect(second).toBe(first);
    expect(harness.faces).toHaveLength(3);

    releaseLoads?.();
    await first;

    await registry.ensure(harness.doc, FONT_DEFINITIONS);
    expect(harness.faces).toHaveLength(3);
    expect(harness.add).toHaveBeenCalledTimes(3);
  });

  it("registers fonts independently in separate documents", async () => {
    const registry = new DocumentFontRegistry();
    const first = createFontDocument();
    const second = createFontDocument();

    await Promise.all([
      registry.ensure(first.doc, FONT_DEFINITIONS),
      registry.ensure(second.doc, FONT_DEFINITIONS)
    ]);

    expect(first.add).toHaveBeenCalledTimes(3);
    expect(second.add).toHaveBeenCalledTimes(3);
  });

  it("does not reject rendering when a font fails to load", async () => {
    const registry = new DocumentFontRegistry();
    const harness = createFontDocument({ failLoadAt: new Set([1]) });

    await expect(registry.ensure(harness.doc, FONT_DEFINITIONS)).resolves.toBeUndefined();
    expect(harness.faces.map((face) => face.loadCalls)).toEqual([1, 1, 1]);
    expect(harness.add).toHaveBeenCalledTimes(3);
  });
});
