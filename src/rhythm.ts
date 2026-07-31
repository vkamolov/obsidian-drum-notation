import {
  DrumRhythmRegion,
  GridResolution
} from "./types";

export interface TupletPatternIssue {
  code:
    | "malformed-tuplet"
    | "unsupported-tuplet-duration"
    | "unsupported-tuplet-span";
  message: string;
  beat: number;
}

export interface TupletPatternAnalysis {
  decodedPattern: string;
  regions: DrumRhythmRegion[];
  containsTupletSyntax: boolean;
  issues: TupletPatternIssue[];
}

const TUPLET_START = /^(\d+)(?:([/@])(\d+))?\(/;
const TUPLET_LIKE = /\d+(?:[/@]\d+)?\(/;
const EXPLICIT_TUPLET_DURATION_DENOMINATORS = new Set([2, 4, 8, 16, 32]);
export const MAX_TUPLET_TICKABLE_DENOMINATOR = 128;

export function analyzeTupletPattern(
  pattern: string,
  timeSignature: string,
  gridResolution: GridResolution
): TupletPatternAnalysis {
  const slotsPerBeat = getSlotsPerBeat(timeSignature, gridResolution);
  const beatQuarter = getWrittenBeatQuarter(timeSignature);
  const barQuarter = getBarDurationQuarter(timeSignature);
  const regions: DrumRhythmRegion[] = [];
  const issues: TupletPatternIssue[] = [];
  let decodedPattern = "";
  let plainBuffer = "";
  let quarterCursor = 0;
  let positionCursor = 0;
  let sourceCursor = 0;

  const flushPlain = () => {
    while (plainBuffer.length > 0) {
      const positionCount = Math.min(slotsPerBeat, plainBuffer.length);
      const durationQuarter = positionCount * (4 / gridResolution);

      regions.push({
        kind: "plain",
        startPosition: positionCursor,
        positionCount,
        startQuarter: quarterCursor,
        durationQuarter,
        spanWrittenBeats: durationQuarter / beatQuarter,
        subdivisionCount: positionCount
      });
      decodedPattern += plainBuffer.slice(0, positionCount);
      plainBuffer = plainBuffer.slice(positionCount);
      positionCursor += positionCount;
      quarterCursor += durationQuarter;
    }
  };

  while (sourceCursor < pattern.length) {
    const remainder = pattern.slice(sourceCursor);
    const tokenStart = TUPLET_START.exec(remainder);

    if (!tokenStart) {
      plainBuffer += pattern[sourceCursor];
      sourceCursor += 1;

      if (plainBuffer.length === slotsPerBeat) {
        flushPlain();
      }
      continue;
    }

    flushPlain();
    const firstCount = Number.parseInt(tokenStart[1], 10);
    const modifier = tokenStart[2];
    const modifierValue = tokenStart[3] === undefined
      ? undefined
      : Number.parseInt(tokenStart[3], 10);
    const isReservedBeatSpan = modifier === "/";
    const explicitDurationDenominator = modifier === "@" ? modifierValue : undefined;
    const subdivisionCount = isReservedBeatSpan
      ? modifierValue ?? firstCount
      : firstCount;
    const durationQuarter = explicitDurationDenominator === undefined
      ? beatQuarter
      : 4 / explicitDurationDenominator;
    const spanWrittenBeats = isReservedBeatSpan
      ? firstCount
      : durationQuarter / beatQuarter;
    const bodyStart = sourceCursor + tokenStart[0].length;
    const closeIndex = pattern.indexOf(")", bodyStart);
    const beat = Math.floor(quarterCursor / beatQuarter) + 1;

    if (closeIndex < 0) {
      issues.push({
        code: "malformed-tuplet",
        message: `Tuplet at beat ${beat} is missing its closing parenthesis.`,
        beat
      });
      break;
    }

    const body = pattern.slice(bodyStart, closeIndex);

    const startsAtBeatBoundary =
      Math.abs(quarterCursor / beatQuarter - Math.round(quarterCursor / beatQuarter)) <
      1e-8;
    const tickableDenominator = explicitDurationDenominator === undefined
      ? null
      : getTupletTickableDenominator(subdivisionCount, explicitDurationDenominator);

    if (isReservedBeatSpan) {
      issues.push({
        code: "unsupported-tuplet-span",
        message: `Tuplet ${spanWrittenBeats}/${subdivisionCount}(...) at beat ${beat} uses a reserved multi-beat form that is not supported yet.`,
        beat
      });
    } else if (subdivisionCount < 3 || subdivisionCount > 12) {
      issues.push({
        code: "malformed-tuplet",
        message: `Tuplet at beat ${beat} uses ${subdivisionCount} subdivisions; supported values are 3–12.`,
        beat
      });
    } else if (
      explicitDurationDenominator !== undefined &&
      !EXPLICIT_TUPLET_DURATION_DENOMINATORS.has(explicitDurationDenominator)
    ) {
      issues.push({
        code: "unsupported-tuplet-duration",
        message: `Tuplet ${subdivisionCount}@${explicitDurationDenominator}(...) at beat ${beat} uses an unsupported duration; supported denominators are 2, 4, 8, 16, and 32.`,
        beat
      });
    } else if (
      explicitDurationDenominator !== undefined &&
      tickableDenominator !== null &&
      tickableDenominator > MAX_TUPLET_TICKABLE_DENOMINATOR
    ) {
      issues.push({
        code: "unsupported-tuplet-duration",
        message: `Tuplet ${subdivisionCount}@${explicitDurationDenominator}(...) at beat ${beat} requires ${tickableDenominator}th-note tickables; the supported limit is ${MAX_TUPLET_TICKABLE_DENOMINATOR}.`,
        beat
      });
    } else if (explicitDurationDenominator === undefined && !startsAtBeatBoundary) {
      issues.push({
        code: "malformed-tuplet",
        message: `Tuplet at beat ${beat} must begin on a written-beat boundary unless it declares an explicit @ duration.`,
        beat
      });
    } else if (body.includes("(") || body.includes(")")) {
      issues.push({
        code: "malformed-tuplet",
        message: `Tuplet at beat ${beat} contains nested parentheses, which are not supported.`,
        beat
      });
    } else if (Array.from(body).length !== subdivisionCount) {
      issues.push({
        code: "malformed-tuplet",
        message: `Tuplet at beat ${beat} declares ${subdivisionCount} subdivisions but contains ${Array.from(body).length} positions.`,
        beat
      });
    } else if (quarterCursor + durationQuarter > barQuarter + Number.EPSILON) {
      issues.push({
        code: "malformed-tuplet",
        message: `Tuplet at beat ${beat} extends beyond the ${timeSignature} bar.`,
        beat
      });
    } else {
      regions.push({
        kind: "tuplet",
        startPosition: positionCursor,
        positionCount: subdivisionCount,
        startQuarter: quarterCursor,
        durationQuarter,
        spanWrittenBeats,
        subdivisionCount
      });
      decodedPattern += body;
      positionCursor += subdivisionCount;
      quarterCursor += durationQuarter;
    }

    sourceCursor = closeIndex + 1;
  }

  flushPlain();

  return {
    decodedPattern,
    regions,
    containsTupletSyntax: TUPLET_LIKE.test(pattern),
    issues
  };
}

export function buildPlainRhythmRegions(
  positionCount: number,
  timeSignature: string,
  gridResolution: GridResolution
): DrumRhythmRegion[] {
  const slotsPerBeat = getSlotsPerBeat(timeSignature, gridResolution);
  const beatQuarter = getWrittenBeatQuarter(timeSignature);
  const regions: DrumRhythmRegion[] = [];
  let startPosition = 0;
  let startQuarter = 0;

  while (startPosition < positionCount) {
    const count = Math.min(slotsPerBeat, positionCount - startPosition);
    const durationQuarter = count * (4 / gridResolution);

    regions.push({
      kind: "plain",
      startPosition,
      positionCount: count,
      startQuarter,
      durationQuarter,
      spanWrittenBeats: durationQuarter / beatQuarter,
      subdivisionCount: count
    });
    startPosition += count;
    startQuarter += durationQuarter;
  }

  return regions;
}

export function flattenTupletSyntax(pattern: string): string {
  return pattern
    .replace(/\d+(?:[/@]\d+)?\(/g, "")
    .replace(/[()]/g, "");
}

export function containsTupletLikeSyntax(pattern: string): boolean {
  return TUPLET_LIKE.test(pattern);
}

export function rhythmSignature(regions: readonly DrumRhythmRegion[]): string {
  return regions
    .map((region) =>
      [
        region.kind,
        region.positionCount,
        normalizeNumber(region.startQuarter),
        normalizeNumber(region.durationQuarter),
        normalizeNumber(region.spanWrittenBeats)
      ].join(":")
    )
    .join("|");
}

export function getWrittenBeatQuarter(timeSignature: string): number {
  return 4 / getBeatValue(timeSignature);
}

export function getBarDurationQuarter(timeSignature: string): number {
  const match = /^(\d+)\/(\d+)$/.exec(timeSignature);
  const numerator = Math.max(1, Number.parseInt(match?.[1] ?? "4", 10));
  const denominator = Math.max(1, Number.parseInt(match?.[2] ?? "4", 10));

  return numerator * (4 / denominator);
}

export function getRegionEndQuarter(region: DrumRhythmRegion): number {
  return region.startQuarter + region.durationQuarter;
}

export function getTupletTickableDenominator(
  subdivisionCount: number,
  durationDenominator: number
): number {
  return durationDenominator * largestPowerOfTwoAtMost(subdivisionCount);
}

export function getTupletDurationDenominator(region: DrumRhythmRegion): number {
  return Math.round(4 / region.durationQuarter);
}

function normalizeNumber(value: number): string {
  return String(Math.round(value * 1_000_000_000) / 1_000_000_000);
}

function largestPowerOfTwoAtMost(value: number): number {
  let power = 1;

  while (power * 2 <= value) {
    power *= 2;
  }

  return power;
}

function getSlotsPerBeat(
  timeSignature: string,
  gridResolution: GridResolution
): number {
  return Math.max(1, Math.round(gridResolution / getBeatValue(timeSignature)));
}

function getBeatValue(timeSignature: string): number {
  const match = /^\d+\/(\d+)$/.exec(timeSignature);

  return Math.max(1, Number.parseInt(match?.[1] ?? "4", 10));
}
