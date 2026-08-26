import { validateDrumNotation, DrumNotationValidationResult } from "../../src/validation";

export const MAX_AGENT_RESPONSE_BYTES = 1024 * 1024;
export const MAX_IMPORT_SEGMENTS = 16;
export const MAX_IMPORT_BLOCK_BYTES = 128 * 1024;
export const MAX_SOURCE_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_SOURCE_IMAGE_SIDE = 10_000;
export const MAX_SOURCE_IMAGE_PIXELS = 40_000_000;

export type ImportReportState = "missing" | "valid" | "malformed";
export type HumanReviewState = "unreviewed" | "needs-changes" | "approved";

export interface ImportReportMessage {
  code: string;
  message: string;
}

export interface ImportReportWorkaround {
  feature: string;
  action: string;
  loss: "none" | "appearance" | "structure" | "meaning";
}

export interface ImportReportSegment {
  id: string;
  title?: string;
  blockIndex: number;
  validationStatus: "clean" | "warnings" | "unavailable";
  issues: ImportReportMessage[];
  ambiguities: ImportReportMessage[];
  workarounds: ImportReportWorkaround[];
}

export interface DrumImportReport {
  schemaVersion: 1;
  importerVersion: string;
  notationCoreVersion: string;
  notationCoreDigest: string;
  validatorBuildDigest: string;
  source: { kind: "image" | "pdf-page"; page?: number };
  validationStatus: "clean" | "warnings" | "unavailable";
  segments: ImportReportSegment[];
  humanReviewRequired: true;
}

export interface ExtractedImportSegment {
  source: string;
  validation: DrumNotationValidationResult;
}

export interface ExtractedAgentResponse {
  segments: ExtractedImportSegment[];
  unfencedCandidate: ExtractedImportSegment | null;
  report: DrumImportReport | null;
  reportState: ImportReportState;
  errors: string[];
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isMessageArray(value: unknown): value is ImportReportMessage[] {
  return Array.isArray(value) && value.every((entry) =>
    isObject(entry) &&
    hasOnlyKeys(entry, ["code", "message"]) &&
    typeof entry.code === "string" &&
    typeof entry.message === "string"
  );
}

function isWorkaroundArray(value: unknown): value is ImportReportWorkaround[] {
  const losses = new Set(["none", "appearance", "structure", "meaning"]);
  return Array.isArray(value) && value.every((entry) =>
    isObject(entry) &&
    hasOnlyKeys(entry, ["feature", "action", "loss"]) &&
    typeof entry.feature === "string" &&
    typeof entry.action === "string" &&
    typeof entry.loss === "string" &&
    losses.has(entry.loss)
  );
}

export function parseImportReport(value: unknown, blockCount: number): DrumImportReport | null {
  if (!isObject(value) || !hasOnlyKeys(value, [
    "schemaVersion", "importerVersion", "notationCoreVersion", "notationCoreDigest", "validatorBuildDigest",
    "source", "validationStatus", "segments", "humanReviewRequired"
  ])) {
    return null;
  }
  const statuses = new Set(["clean", "warnings", "unavailable"]);
  if (
    value.schemaVersion !== 1 ||
    typeof value.importerVersion !== "string" ||
    typeof value.notationCoreVersion !== "string" ||
    typeof value.notationCoreDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.notationCoreDigest) ||
    typeof value.validatorBuildDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.validatorBuildDigest) ||
    typeof value.validationStatus !== "string" || !statuses.has(value.validationStatus) ||
    value.humanReviewRequired !== true ||
    !isObject(value.source) || !hasOnlyKeys(value.source, ["kind", "page"]) ||
    (value.source.kind !== "image" && value.source.kind !== "pdf-page") ||
    (value.source.page !== undefined && (!Number.isInteger(value.source.page) || Number(value.source.page) < 1)) ||
    !Array.isArray(value.segments) || value.segments.length === 0 || value.segments.length > MAX_IMPORT_SEGMENTS
  ) {
    return null;
  }

  const segments: ImportReportSegment[] = [];
  for (const segment of value.segments) {
    if (
      !isObject(segment) ||
      !hasOnlyKeys(segment, ["id", "title", "blockIndex", "validationStatus", "issues", "ambiguities", "workarounds"]) ||
      typeof segment.id !== "string" || segment.id.length === 0 ||
      (segment.title !== undefined && typeof segment.title !== "string") ||
      !Number.isInteger(segment.blockIndex) || Number(segment.blockIndex) < 0 || Number(segment.blockIndex) >= blockCount ||
      typeof segment.validationStatus !== "string" || !statuses.has(segment.validationStatus) ||
      !isMessageArray(segment.issues) || !isMessageArray(segment.ambiguities) || !isWorkaroundArray(segment.workarounds)
    ) {
      return null;
    }
    segments.push(segment as unknown as ImportReportSegment);
  }

  return { ...value, segments } as unknown as DrumImportReport;
}

export function extractAgentResponse(response: string): ExtractedAgentResponse {
  const errors: string[] = [];
  if (byteLength(response) > MAX_AGENT_RESPONSE_BYTES) {
    return {
      segments: [],
      unfencedCandidate: null,
      report: null,
      reportState: "missing",
      errors: [`Response exceeds ${MAX_AGENT_RESPONSE_BYTES} bytes.`]
    };
  }

  const normalizedResponse = response.replace(/\r\n?/g, "\n");
  const lines = normalizedResponse.split("\n");
  const drumBlocks: string[] = [];
  const reportBlocks: string[] = [];
  const hasMarkdownFence = lines.some((line) => /^\s*(?:`{3,}|~{3,})/.test(line));

  for (let index = 0; index < lines.length; index++) {
    const opening = lines[index].match(/^```(drums|drum-import-report)\s*$/);
    if (!opening) {
      continue;
    }
    const language = opening[1];
    const content: string[] = [];
    index += 1;
    while (index < lines.length && lines[index] !== "```") {
      content.push(lines[index]);
      index += 1;
    }
    if (index >= lines.length) {
      errors.push(`Unclosed ${language} fence.`);
      break;
    }
    const block = content.join("\n").trim();
    if (byteLength(block) > MAX_IMPORT_BLOCK_BYTES) {
      errors.push(`${language} block exceeds ${MAX_IMPORT_BLOCK_BYTES} bytes.`);
      continue;
    }
    if (language === "drums") {
      if (drumBlocks.length >= MAX_IMPORT_SEGMENTS) {
        errors.push(`Response contains more than ${MAX_IMPORT_SEGMENTS} drums blocks.`);
        continue;
      }
      drumBlocks.push(block);
    } else {
      reportBlocks.push(block);
    }
  }

  let unfencedCandidate: ExtractedImportSegment | null = null;
  if (drumBlocks.length === 0) {
    errors.push("No fenced drums blocks found.");
    const source = normalizedResponse.trim();
    if (!hasMarkdownFence && source.length > 0) {
      if (byteLength(source) > MAX_IMPORT_BLOCK_BYTES) {
        errors.push(`Unfenced pasted text exceeds ${MAX_IMPORT_BLOCK_BYTES} bytes.`);
      } else {
        const validation = validateDrumNotation(source);
        if (validation.status !== "invalid") {
          unfencedCandidate = { source, validation };
        }
      }
    }
  }
  const segments = drumBlocks.map((source) => ({ source, validation: validateDrumNotation(source) }));
  if (reportBlocks.length === 0) {
    return { segments, unfencedCandidate, report: null, reportState: "missing", errors };
  }
  if (reportBlocks.length > 1) {
    errors.push("More than one drum-import-report block was supplied.");
    return { segments, unfencedCandidate, report: null, reportState: "malformed", errors };
  }

  try {
    const report = parseImportReport(JSON.parse(reportBlocks[0]), drumBlocks.length);
    if (!report) {
      errors.push("The drum-import-report does not match schema version 1.");
      return { segments, unfencedCandidate, report: null, reportState: "malformed", errors };
    }
    return { segments, unfencedCandidate, report, reportState: "valid", errors };
  } catch {
    errors.push("The drum-import-report is not valid JSON.");
    return { segments, unfencedCandidate, report: null, reportState: "malformed", errors };
  }
}

export function compareReportCore(report: DrumImportReport | null, currentVersion: string, currentDigest: string): "unavailable" | "same" | "different" {
  if (!report) {
    return "unavailable";
  }
  return report.notationCoreVersion === currentVersion && report.notationCoreDigest === currentDigest ? "same" : "different";
}

export function detectRasterImageKind(bytes: Uint8Array): "png" | "jpeg" | "webp" | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  const text = String.fromCharCode(...bytes.slice(0, 12));
  if (bytes.length >= 12 && text.slice(0, 4) === "RIFF" && text.slice(8, 12) === "WEBP") {
    return "webp";
  }
  return null;
}

export function isAllowedRasterDimensions(width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) &&
    width > 0 && height > 0 &&
    width <= MAX_SOURCE_IMAGE_SIDE && height <= MAX_SOURCE_IMAGE_SIDE &&
    width * height <= MAX_SOURCE_IMAGE_PIXELS;
}
