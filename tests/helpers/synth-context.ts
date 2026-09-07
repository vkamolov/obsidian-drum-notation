import { vi } from "vitest";

class Parameter {
  setValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
}
export class SynthNode {
  gain = new Parameter(); frequency = new Parameter(); Q = new Parameter();
  buffer: unknown; loop = false; playbackRate = new Parameter();
  readonly listeners = new Set<() => void>();
  connect = vi.fn((target: SynthNode) => target);
  disconnect = vi.fn(); start = vi.fn(); stop = vi.fn();
  addEventListener(_event: string, listener: () => void) { this.listeners.add(listener); }
  removeEventListener(_event: string, listener: () => void) { this.listeners.delete(listener); }
  end() { [...this.listeners].forEach(listener => listener()); }
}
export function synthContext() {
  const nodes: SynthNode[] = [], sources: SynthNode[] = [];
  const makeNode = () => { const node = new SynthNode(); nodes.push(node); return node; };
  const makeSource = () => { const source = makeNode(); sources.push(source); return source; };
  const context = {
    state: "running", currentTime: 0, sampleRate: 44100, destination: makeNode(),
    createGain: vi.fn(makeNode), createBiquadFilter: vi.fn(makeNode),
    createOscillator: vi.fn(makeSource), createBufferSource: vi.fn(makeSource),
    createBuffer: vi.fn((_channels: number, size: number) => ({getChannelData: () => new Float32Array(size), duration: size / 44100}))
  };
  return {context: context as unknown as AudioContext, raw: context, nodes, sources};
}
