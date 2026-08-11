import { describe, expect, it } from "vitest";
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
  importerVersion: "0.1.0",
  notationCoreVersion: "1.5.0",
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

  it("accepts a valid report and compares notation cores", () => {
    const result = extractAgentResponse(`\`\`\`drums\nHH | x-x-x-x-x-x-x-x-\n\`\`\`\n\`\`\`drum-import-report\n${report}\n\`\`\``);
    expect(result.reportState).toBe("valid");
    expect(compareReportCore(result.report, "1.5.0", digest)).toBe("same");
    expect(compareReportCore(result.report, "1.6.0", digest)).toBe("different");
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
