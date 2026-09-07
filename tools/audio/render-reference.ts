import { DrumSynth } from "../../src/synth";
import { DRUM_KIT } from "../../src/kit";
import type { DrumArticulation, DrumHit, DrumPlaybackKind } from "../../src/types";

interface Stroke { kind: DrumPlaybackKind; articulation?: DrumArticulation; time?: number; duration?: number }
interface Fixture { id: string; strokes: Stroke[]; length: number }
const kinds: DrumPlaybackKind[] = ["kick", "snare", "tomHigh", "tomMid", "tomLow", "hatClosed", "hatHalfOpen", "hatOpen", "hatFoot", "hatFootSplash", "ride", "rideBell", "crash", "splash", "china", "stack", "cowbell", "click"];
export const fixtures: Fixture[] = kinds.map(kind => ({ id: kind, strokes: [{ kind }], length: 2.1 }));
for (const kind of ["snare", "hatClosed", "hatHalfOpen", "hatOpen", "hatFoot", "ride", "rideBell", "crash", "splash", "china", "stack"] as const) {
  fixtures.push({ id: `${kind}-accent`, strokes: [{kind, articulation: "accent"}], length: 2.1 });
}
for (const articulation of ["ghost", "flam", "drag", "diddle", "choke"] as const) {
  fixtures.push({id: `snare-${articulation}`, strokes: [{kind: "snare", articulation}], length: 1});
}
for (const kind of ["crash", "hatOpen", "ride"] as const) fixtures.push({id: `${kind}-choke`, strokes: [{kind, articulation: "choke"}], length: 1});
for (const duration of [0.06, 0.5, 3]) fixtures.push({id: `buzz-${duration}`, strokes: [{kind: "snare", articulation: "buzz", duration}], length: duration + 0.4});
fixtures.push({id: "overlap", length: 2.4, strokes: [
  {kind: "snare"}, {kind: "hatClosed"}, {kind: "crash"},
  {kind: "snare", time: 0.225, articulation: "drag"}, {kind: "hatClosed", time: 0.225},
  {kind: "snare", time: 0.35, articulation: "flam"}, {kind: "hatOpen", time: 0.35}
]});

function randomSource(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state += 0x6D2B79F5; let n = state; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
}

function centroid(samples: Float32Array, offset: number, width: number, rate: number): number {
  let size = 1; while (size < width) size *= 2;
  const real = new Float64Array(size), imaginary = new Float64Array(size);
  for (let i = 0; i < width; i++) real[i] = (samples[offset + i] ?? 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (width - 1)));
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) [real[i], real[j]] = [real[j], real[i]];
  }
  for (let length = 2; length <= size; length *= 2) {
    const angle = -2 * Math.PI / length;
    for (let start = 0; start < size; start += length) {
      for (let j = 0; j < length / 2; j++) {
        const a = start + j, b = a + length / 2, c = Math.cos(angle * j), s = Math.sin(angle * j);
        const re = real[b] * c - imaginary[b] * s, im = real[b] * s + imaginary[b] * c;
        real[b] = real[a] - re; imaginary[b] = imaginary[a] - im; real[a] += re; imaginary[a] += im;
      }
    }
  }
  let sum = 0, weighted = 0;
  for (let i = 0; i <= size / 2; i++) { const magnitude = Math.hypot(real[i], imaginary[i]); sum += magnitude; weighted += magnitude * i * rate / size; }
  return sum ? weighted / sum : 0;
}

export async function render(id: string, sampleRate: number, seed: number | null) {
  const fixture = fixtures.find(item => item.id === id);
  if (!fixture) throw new Error(`Unknown fixture ${id}`);
  const offline = new OfflineAudioContext(1, Math.ceil(fixture.length * sampleRate), sampleRate);
  // Test-only bridge: OfflineAudioContext renders on demand; its initially suspended state
  // must not enter the production real-time resume path. Web Audio methods retain their receiver.
  const context = new Proxy(offline, {get(target, key) {
    if (key === "state") return "running";
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  }}) as unknown as AudioContext;
  const previousRandom = Math.random;
  try {
    if (seed !== null) Math.random = randomSource(seed);
    const synth = new DrumSynth(context);
    await synth.start();
    for (const stroke of fixture.strokes) {
      const instrument = DRUM_KIT.find(item => item.playback === stroke.kind) ?? {...DRUM_KIT[0], id: "click", playback: "click" as const};
      const hit: DrumHit = {instrument, articulation: stroke.articulation ?? "normal", velocity: stroke.articulation === "ghost" ? 0.25 : 0.7};
      synth.scheduleHits([hit], stroke.time ?? 0.1, stroke.duration ?? 0.25, stroke.duration ?? 0.25);
    }
    const rendered = await offline.startRendering();
    synth.stop();
    const samples = rendered.getChannelData(0), width = Math.round(sampleRate / 100);
    const rms: number[] = [], centroids: number[] = [];
    let energy = 0, peak = 0, nonFinite = 0, clipping = 0;
    for (const value of samples) { energy += value * value; peak = Math.max(peak, Math.abs(value)); if (!Number.isFinite(value)) nonFinite++; if (Math.abs(value) >= 1) clipping++; }
    for (let offset = 0; offset < samples.length; offset += width) {
      let sum = 0; for (let i = offset; i < Math.min(offset + width, samples.length); i++) sum += samples[i] ** 2;
      const level = 10 * Math.log10(Math.max(1e-16, sum / width));
      rms.push(level); centroids.push(level > -60 ? centroid(samples, offset, width, sampleRate) : 0);
    }
    const audible = rms.map((value, index) => value > -60 ? index : -1).filter(index => index >= 0);
    let pcm: string | null = null;
    if (seed !== null) {
      const bytes = new Uint8Array(samples.buffer); let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      pcm = btoa(binary);
    }
    return {energy: 10 * Math.log10(Math.max(1e-16, energy / sampleRate)), peak, nonFinite, clipping, rms, centroids, attack: audible[0] ?? -1, end: audible.at(-1) ?? -1, pcm};
  } finally { Math.random = previousRandom; }
}
