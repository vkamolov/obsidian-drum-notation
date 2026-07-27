import { DrumBarClipboardPayload } from "./types";

export type BarClipboardListener = (payload: DrumBarClipboardPayload | null) => void;

export class DrumBarClipboardStore {
  private payload: DrumBarClipboardPayload | null = null;
  private readonly listeners = new Set<BarClipboardListener>();

  get(): DrumBarClipboardPayload | null {
    return this.payload ? clonePayload(this.payload) : null;
  }

  set(payload: unknown): boolean {
    if (!isDrumBarClipboardPayload(payload)) {
      return false;
    }

    this.payload = clonePayload(payload);
    this.emit();
    return true;
  }

  clear(): void {
    if (!this.payload) {
      return;
    }

    this.payload = null;
    this.emit();
  }

  subscribe(listener: BarClipboardListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const payload = this.get();
    this.listeners.forEach((listener) => listener(payload));
  }
}

export function isDrumBarClipboardPayload(value: unknown): value is DrumBarClipboardPayload {
  if (!isRecord(value)) {
    return false;
  }

  if (
    value.kind !== "drum-notation-bar" ||
    value.version !== 1 ||
    typeof value.timeSignature !== "string" ||
    (value.gridResolution !== 16 && value.gridResolution !== 32) ||
    typeof value.width !== "number" ||
    !Number.isInteger(value.width) ||
    value.width <= 0 ||
    !Array.isArray(value.rows)
  ) {
    return false;
  }

  const width = value.width;
  const rowsValid = value.rows.every(
    (row: unknown) =>
      isRecord(row) &&
      typeof row.instrumentId === "string" &&
      typeof row.label === "string" &&
      typeof row.pattern === "string" &&
      Array.from(row.pattern).length === width
  );
  const stickingValid =
    value.stickingPattern === undefined ||
    (typeof value.stickingPattern === "string" && Array.from(value.stickingPattern).length === width);

  return rowsValid && stickingValid;
}

export function serializeDrumBarClipboardText(payload: DrumBarClipboardPayload): string {
  const lines = [`Time: ${payload.timeSignature}`, `Grid: ${payload.gridResolution}`];

  if (payload.stickingPattern) {
    lines.push(`ST | ${payload.stickingPattern}`);
  }

  payload.rows.forEach((row) => lines.push(`${row.label} | ${row.pattern}`));

  if (payload.rows.length === 0 && !payload.stickingPattern) {
    lines.push(`HH | ${"-".repeat(payload.width)}`);
  }

  return `\`\`\`drums\n${lines.join("\n")}\n\`\`\``;
}

function clonePayload(payload: DrumBarClipboardPayload): DrumBarClipboardPayload {
  return {
    ...payload,
    rows: payload.rows.map((row) => ({ ...row }))
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
