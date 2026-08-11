import { parseDrumBlockWithWarnings } from "./parser";
import { serializeDrumBlock } from "./serializer";
import { ParseWarning } from "./types";

export type DrumNotationValidationStatus = "clean" | "warnings" | "invalid";

export interface DrumNotationValidationResult {
  status: DrumNotationValidationStatus;
  normalized: string;
  warnings: ParseWarning[];
  errors: string[];
}

export function validateDrumNotation(source: string): DrumNotationValidationResult {
  try {
    const parsed = parseDrumBlockWithWarnings(source);
    const normalized = serializeDrumBlock(parsed.block);
    const errors: string[] = [];

    if (parsed.block.rows.length === 0) {
      errors.push("No supported drum rows were parsed.");
    }

    if (normalized.length > 0) {
      const reparsed = parseDrumBlockWithWarnings(normalized);
      const renormalized = serializeDrumBlock(reparsed.block);

      if (renormalized !== normalized) {
        errors.push("Normalized notation is not serializer-idempotent.");
      }
    }

    return {
      status: errors.length > 0 ? "invalid" : parsed.warnings.length > 0 ? "warnings" : "clean",
      normalized,
      warnings: parsed.warnings,
      errors
    };
  } catch (error) {
    return {
      status: "invalid",
      normalized: "",
      warnings: [],
      errors: [error instanceof Error ? error.message : String(error)]
    };
  }
}
