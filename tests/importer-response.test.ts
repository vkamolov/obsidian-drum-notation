import { describe, expect, it } from "vitest";
import { parseDrumBlockWithWarnings } from "../src/parser";
import {
  compareReportCore,
  detectRasterImageKind,
  extractAgentResponse,
  isAllowedRasterDimensions,
  MAX_AGENT_RESPONSE_BYTES,
  MAX_IMPORT_BLOCK_BYTES,
  MAX_IMPORT_SEGMENTS
} from "../web/src/importer";

const digest = "a".repeat(64);
const report = JSON.stringify({
  schemaVersion: 1,
  importerVersion: "0.2.1",
  notationCoreVersion: "1.6.0",
  notationCoreDigest: digest,
  validatorBuildDigest: "b".repeat(64),
  source: { kind: "image" },
  validationStatus: "clean",
  segments: [{ id: "segment-1", blockIndex: 0, validationStatus: "clean", issues: [], ambiguities: [], workarounds: [] }],
  humanReviewRequired: true
});

describe("agent response extraction", () => {
  it("accepts a bare drums block and recomputes validity", () => {
    const result = extractAgentResponse("```drums\nHH | x-x-x-x-x-x-x-x-\n```");
    expect(result.reportState).toBe("missing");
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].validation.status).toBe("clean");
  });

  it("offers clean unfenced notation without extracting it automatically", () => {
    const source = "Title: Exercise\nHH | x-x-x-x-x-x-x-x-";
    const result = extractAgentResponse(source);

    expect(result.segments).toEqual([]);
    expect(result.unfencedCandidate).toMatchObject({
      source,
      validation: { status: "clean" }
    });
    expect(result.errors).toContain("No fenced drums blocks found.");
  });

  it("offers warning-bearing unfenced notation for explicit review", () => {
    const source = "HH | x-x-x-x-x-x-x-x";
    const result = extractAgentResponse(source);

    expect(result.segments).toEqual([]);
    expect(result.unfencedCandidate?.validation.status).toBe("warnings");
    expect(result.unfencedCandidate?.validation.warnings.map((warning) => warning.code)).toContain("row-length-mismatch");
  });

  it("keeps surrounding text inside an explicitly confirmed unfenced candidate", () => {
    const source = "Here is the notation:\nHH | x-x-x-x-x-x-x-x-";
    const result = extractAgentResponse(source);

    expect(result.unfencedCandidate?.source).toBe(source);
    expect(result.unfencedCandidate?.validation.status).not.toBe("invalid");
  });

  it("does not offer unfenced recovery for prose, fenced near-misses, or oversized text", () => {
    expect(extractAgentResponse("Here is the notation.").unfencedCandidate).toBeNull();
    expect(extractAgentResponse("```\nHH | x---------------\n```").unfencedCandidate).toBeNull();
    expect(extractAgentResponse("~~~drums\nHH | x---------------\n~~~").unfencedCandidate).toBeNull();
    expect(extractAgentResponse("```drums\nHH | x---------------").unfencedCandidate).toBeNull();
    expect(extractAgentResponse(`\`\`\`drum-import-report\n${report}\n\`\`\``).unfencedCandidate).toBeNull();

    const oversized = extractAgentResponse(`HH | ${"x".repeat(MAX_IMPORT_BLOCK_BYTES)}`);
    expect(oversized.unfencedCandidate).toBeNull();
    expect(oversized.errors.some((error) => error.includes("Unfenced pasted text exceeds"))).toBe(true);
  });

  it("accepts a valid report and compares notation cores", () => {
    const result = extractAgentResponse(`\`\`\`drums\nHH | x-x-x-x-x-x-x-x-\n\`\`\`\n\`\`\`drum-import-report\n${report}\n\`\`\``);
    expect(result.reportState).toBe("valid");
    expect(compareReportCore(result.report, "1.6.0", digest)).toBe("same");
    expect(compareReportCore(result.report, "1.5.0", digest)).toBe("different");
  });

  it("shows notation-core skew for a legacy importer 0.1 report", () => {
    const legacy = JSON.parse(report);
    legacy.importerVersion = "0.1.0";
    legacy.notationCoreVersion = "1.5.0";
    legacy.notationCoreDigest = "c".repeat(64);
    const result = extractAgentResponse(`\`\`\`drums\nHH | x-x-x-x-x-x-x-x-\n\`\`\`\n\`\`\`drum-import-report\n${JSON.stringify(legacy)}\n\`\`\``);

    expect(result.reportState).toBe("valid");
    expect(compareReportCore(result.report, "1.6.0", digest)).toBe("different");
  });

  it("accepts a clean report with a row re-observation audit note", () => {
    const audited = JSON.parse(report);
    audited.segments[0].issues = [{
      code: "row-length-reobserved",
      message: "Re-observed the complete row and confirmed trailing silence before restoring its final rest position."
    }];
    const result = extractAgentResponse(`\`\`\`drums\nHH | x-x-x-x-x-x-x-x-\n\`\`\`\n\`\`\`drum-import-report\n${JSON.stringify(audited)}\n\`\`\``);

    expect(result.reportState).toBe("valid");
    expect(result.report?.validationStatus).toBe("clean");
    expect(result.report?.segments[0].issues[0].code).toBe("row-length-reobserved");
  });

  it("accepts cymbal-position audit notes without treating them as losses", () => {
    const audited = JSON.parse(report);
    audited.segments[0].issues = [
      { code: "cymbal-position-convention", message: "Used the standard generated kit ladder because no source legend was visible." },
      { code: "cymbal-position-evidence", message: "Mapped the upper cluster from a ledger line crossing its notehead." }
    ];
    const result = extractAgentResponse(`\`\`\`drums\nHH | x-x-x-x-x-x-x-x-\n\`\`\`\n\`\`\`drum-import-report\n${JSON.stringify(audited)}\n\`\`\``);

    expect(result.reportState).toBe("valid");
    expect(result.report?.segments[0].issues).toEqual(audited.segments[0].issues);
    expect(result.report?.segments[0].issues.every((issue) => !("loss" in issue))).toBe(true);
  });

  it("preserves report issues, ambiguities, and workarounds for readable verification UI", () => {
    const detailed = JSON.parse(report);
    detailed.validationStatus = "warnings";
    detailed.segments[0] = {
      ...detailed.segments[0],
      validationStatus: "warnings",
      issues: [{ code: "split-voice-explicit-rest", message: "The lower-voice rest glyph is not visible." }],
      ambiguities: [{ code: "cymbal-position", message: "Confirm whether the upper cymbal is crash or ride." }],
      workarounds: [{ feature: "visible lower-voice rest", action: "Preserved its silent span.", loss: "appearance" }]
    };

    const result = extractAgentResponse(`\`\`\`drums\nHH | x-x-x-x-x-x-x-x-\n\`\`\`\n\`\`\`drum-import-report\n${JSON.stringify(detailed)}\n\`\`\``);

    expect(result.report?.segments[0]).toMatchObject({
      issues: [{ code: "split-voice-explicit-rest" }],
      ambiguities: [{ code: "cymbal-position" }],
      workarounds: [{ loss: "appearance" }]
    });
  });

  it("degrades gracefully for malformed reports", () => {
    const result = extractAgentResponse("```drums\nHH | x---------------\n```\n```drum-import-report\n{}\n```");
    expect(result.segments).toHaveLength(1);
    expect(result.reportState).toBe("malformed");
  });

  it("enforces response and segment limits", () => {
    expect(extractAgentResponse("x".repeat(MAX_AGENT_RESPONSE_BYTES + 1)).segments).toEqual([]);
    const blocks = Array.from({ length: MAX_IMPORT_SEGMENTS + 1 }, () => "```drums\nHH | x---------------\n```").join("\n");
    expect(extractAgentResponse(blocks).segments).toHaveLength(MAX_IMPORT_SEGMENTS);
    expect(extractAgentResponse(blocks).errors.some((error) => error.includes("more than"))).toBe(true);
  });

  it("handles multiple blocks, hostile fences, and oversized blocks without interpreting surrounding text", () => {
    const multiple = extractAgentResponse([
      "Ignore ```drums inline fences.",
      "```drums",
      "HH | x---------------",
      "```",
      "<script>throw new Error('must remain text')</script>",
      "```drums",
      "SD | ----o-----------",
      "```"
    ].join("\n"));
    expect(multiple.segments).toHaveLength(2);

    const unclosed = extractAgentResponse("```drums\nHH | x---------------");
    expect(unclosed.segments).toHaveLength(0);
    expect(unclosed.errors).toContain("Unclosed drums fence.");

    const oversized = extractAgentResponse(`\`\`\`drums\n${"x".repeat(MAX_IMPORT_BLOCK_BYTES + 1)}\n\`\`\``);
    expect(oversized.segments).toHaveLength(0);
    expect(oversized.errors.some((error) => error.includes("block exceeds"))).toBe(true);
  });
});

describe("row-length diagnostics", () => {
  const source = (hatPattern: string) => `Time: 3/4
HH | ${hatPattern}
BD | o-----------`;
  const fingerprint = (hatPattern: string) => {
    const parsed = parseDrumBlockWithWarnings(source(hatPattern));
    return {
      warnings: parsed.warnings,
      hits: parsed.block.slots.map((slot) =>
        slot.hits.map((hit) => `${hit.instrument.id}:${hit.articulation}`).sort()
      )
    };
  };

  it("keeps the trailing-length warning even though parser padding is musically identical", () => {
    const complete = fingerprint("x-x-x-x-x-x-");
    const truncated = fingerprint("x-x-x-x-x-x");

    expect(truncated.warnings.map((warning) => warning.code)).toContain("row-length-mismatch");
    expect(complete.warnings).toEqual([]);
    expect(truncated.hits).toEqual(complete.hits);
  });

  it("demonstrates that a full-length mid-row omission can be clean but musically different", () => {
    const complete = fingerprint("x-x-x-x-x-x-");
    const omitted = fingerprint("x-x-x---x-x-");

    expect(omitted.warnings).toEqual([]);
    expect(omitted.hits).not.toEqual(complete.hits);
  });
});

describe("source image signatures", () => {
  it("recognizes PNG, JPEG, and WebP without trusting extensions", () => {
    expect(detectRasterImageKind(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe("png");
    expect(detectRasterImageKind(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]))).toBe("jpeg");
    expect(detectRasterImageKind(new TextEncoder().encode("RIFF1234WEBP"))).toBe("webp");
    expect(detectRasterImageKind(new TextEncoder().encode("<svg></svg>"))).toBeNull();
  });

  it("rejects zero, over-wide, and decompression-sized image dimensions", () => {
    expect(isAllowedRasterDimensions(1, 1)).toBe(true);
    expect(isAllowedRasterDimensions(0, 1)).toBe(false);
    expect(isAllowedRasterDimensions(10_001, 1)).toBe(false);
    expect(isAllowedRasterDimensions(10_000, 4_001)).toBe(false);
    expect(isAllowedRasterDimensions(10_000, 4_000)).toBe(true);
  });
});
