import type { DrumHit } from "./types";

export const MAX_GRACE_LEAD_SECONDS = 0.055;
const FLAM = [{offset: -0.035, velocity: 0.45}] as const;
const DRAG = [{offset: -0.055, velocity: 0.34}, {offset: -0.028, velocity: 0.43}] as const;
const NONE = [] as const;

/** Musical offsets stay unclamped; only the audio source boundary clamps to zero. */
export function getGraceStrokes(articulation: DrumHit["articulation"]) {
  return articulation === "flam" ? FLAM : articulation === "drag" ? DRAG : NONE;
}
