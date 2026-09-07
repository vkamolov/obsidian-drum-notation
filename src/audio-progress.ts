/** Serializable identities; snapshots never retain an AudioContext. */
export interface AudioProgressSnapshot {
  contextId: number;
  generation: number;
  activeAudioMs: number;
}

export type PlaybackInterruptionReason = "suspended" | "interrupted" | "closed" | "missed-deadline" | "start-failed";

const contextIds = new WeakMap<object, number>();
let nextContextId = 1;
let nextGeneration = 1;

export function createAudioProgressIdentity(context: object): AudioProgressSnapshot {
  let contextId = contextIds.get(context);
  if (contextId === undefined) {
    contextId = nextContextId++;
    contextIds.set(context, contextId);
  }
  return {contextId, generation: nextGeneration++, activeAudioMs: 0};
}

export function sameAudioProgressOwner(left: AudioProgressSnapshot, right: AudioProgressSnapshot): boolean {
  return left.contextId === right.contextId && left.generation === right.generation;
}

export function normalizeAudioProgress(value: AudioProgressSnapshot | null | undefined): AudioProgressSnapshot | null {
  if (!value || !Number.isInteger(value.contextId) || value.contextId <= 0 ||
      !Number.isInteger(value.generation) || value.generation <= 0 ||
      !Number.isFinite(value.activeAudioMs) || value.activeAudioMs < 0) return null;
  return {...value};
}
