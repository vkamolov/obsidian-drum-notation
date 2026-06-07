import { DrumHit, DrumPlaybackKind } from "./types";

export class DrumSynth {
  // The AudioContext is owned and shared by the plugin (browsers cap the number
  // of live contexts), so a synth never creates or closes it. Each synth instead
  // routes through its own master gain and tracks the node chains it schedules,
  // so stop() can silence just this synth without tearing down the context.
  private master: GainNode | null = null;
  private sources: AudioScheduledSourceNode[] = [];
  private nodes: AudioNode[] = [];

  constructor(private readonly audioContext: AudioContext) {}

  get currentTime(): number {
    return this.audioContext.currentTime;
  }

  async start(): Promise<void> {
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    this.master = this.audioContext.createGain();
    this.master.gain.setValueAtTime(1, this.audioContext.currentTime);
    this.master.connect(this.audioContext.destination);
  }

  stop(): void {
    this.sources.forEach((source) => {
      try {
        source.stop();
      } catch {
        // A source that already ended throws on stop(); ignore it.
      }
    });
    this.sources = [];

    this.nodes.forEach((node) => {
      try {
        node.disconnect();
      } catch {
        // Already disconnected; ignore.
      }
    });
    this.nodes = [];

    if (this.master) {
      try {
        this.master.disconnect();
      } catch {
        // Already disconnected; ignore.
      }

      this.master = null;
    }
  }

  scheduleHits(hits: DrumHit[], time: number, slotDuration = 0, noteDuration = slotDuration): void {
    hits.forEach((hit) => this.scheduleHit(hit, time, slotDuration, noteDuration));
  }

  scheduleHit(hit: DrumHit, time: number, slotDuration = 0, noteDuration = slotDuration): void {
    if (hit.articulation === "flam") {
      this.scheduleInstrument(hit.instrument.playback, Math.max(0, time - 0.035), hit.velocity * 0.45);
    }

    if (hit.articulation === "drag") {
      this.scheduleInstrument(hit.instrument.playback, Math.max(0, time - 0.055), hit.velocity * 0.34);
      this.scheduleInstrument(hit.instrument.playback, Math.max(0, time - 0.028), hit.velocity * 0.43);
    }

    if (hit.articulation === "diddle") {
      this.scheduleInstrument(hit.instrument.playback, time, hit.velocity);
      this.scheduleInstrument(hit.instrument.playback, time + Math.max(0.025, slotDuration / 2), hit.velocity * 0.92);
      return;
    }

    if (hit.articulation === "buzz" && hit.instrument.playback === "snare") {
      this.scheduleBuzzRoll(time, Math.max(slotDuration, noteDuration), hit.velocity);
      return;
    }

    if (hit.articulation === "choke") {
      this.scheduleChokedInstrument(hit.instrument.playback, time, hit.velocity);
      return;
    }

    this.scheduleInstrument(hit.instrument.playback, time, hit.velocity);
  }

  private scheduleChokedInstrument(playback: DrumPlaybackKind, time: number, velocity: number): void {
    switch (playback) {
      case "crash":
        this.scheduleFilteredNoise(time, 0.12, "highpass", 4500, velocity * 0.5, 0.8);
        this.scheduleMetal(time, 0.1, 900, velocity * 0.24);
        break;
      case "splash":
        this.scheduleFilteredNoise(time, 0.1, "highpass", 6400, velocity * 0.44, 0.65);
        this.scheduleMetal(time, 0.09, 1450, velocity * 0.18);
        break;
      case "china":
        this.scheduleFilteredNoise(time, 0.13, "bandpass", 1900, velocity * 0.56, 1.1);
        this.scheduleFilteredNoise(time, 0.1, "highpass", 3600, velocity * 0.2, 0.55);
        break;
      case "stack":
        this.scheduleFilteredNoise(time, 0.08, "bandpass", 3100, velocity * 0.52, 2.2);
        this.scheduleMetal(time, 0.07, 1200, velocity * 0.14);
        break;
      case "ride":
        this.scheduleMetal(time, 0.12, 1800, velocity * 0.3);
        break;
      default:
        this.scheduleInstrument(playback, time, velocity);
        break;
    }
  }

  private scheduleInstrument(playback: DrumPlaybackKind, time: number, velocity: number): void {
    switch (playback) {
      case "kick":
        this.scheduleKick(time, velocity);
        break;
      case "snare":
        this.scheduleSnare(time, velocity);
        break;
      case "tomHigh":
        this.scheduleTom(time, 190, velocity);
        break;
      case "tomMid":
        this.scheduleTom(time, 145, velocity);
        break;
      case "tomLow":
        this.scheduleTom(time, 105, velocity);
        break;
      case "hatClosed":
        this.scheduleNoise(time, 0.045, 7000, velocity * 0.55);
        break;
      case "hatHalfOpen":
        this.scheduleFilteredNoise(time, 0.14, "highpass", 6600, velocity * 0.5, 0.9);
        this.scheduleClick(time, velocity * 0.12);
        break;
      case "hatOpen":
        this.scheduleNoise(time, 0.24, 6200, velocity * 0.5);
        break;
      case "hatFoot":
        this.scheduleNoise(time, 0.08, 5200, velocity * 0.35);
        this.scheduleClick(time, velocity * 0.25);
        break;
      case "hatFootSplash":
        this.scheduleFilteredNoise(time, 0.22, "highpass", 5600, velocity * 0.42, 0.75);
        this.scheduleClick(time, velocity * 0.18);
        break;
      case "ride":
        this.scheduleMetal(time, 0.38, 1800, velocity * 0.35);
        break;
      case "crash":
        this.scheduleNoise(time, 0.8, 4200, velocity * 0.55);
        this.scheduleMetal(time, 0.8, 900, velocity * 0.35);
        break;
      case "splash":
        this.scheduleFilteredNoise(time, 0.36, "highpass", 6200, velocity * 0.46, 0.65);
        this.scheduleMetal(time, 0.32, 1450, velocity * 0.22);
        break;
      case "china":
        this.scheduleFilteredNoise(time, 0.95, "bandpass", 1900, velocity * 0.62, 1.1);
        this.scheduleFilteredNoise(time, 0.62, "highpass", 3600, velocity * 0.24, 0.55);
        this.scheduleMetal(time, 0.78, 650, velocity * 0.26);
        break;
      case "stack":
        this.scheduleFilteredNoise(time, 0.18, "bandpass", 3100, velocity * 0.58, 2.2);
        this.scheduleFilteredNoise(time, 0.12, "highpass", 7600, velocity * 0.28, 0.8);
        this.scheduleMetal(time, 0.14, 1200, velocity * 0.18);
        break;
      case "cowbell":
        this.scheduleCowbell(time, velocity);
        break;
      case "click":
        this.scheduleClick(time, velocity);
        break;
    }
  }

  private scheduleKick(time: number, velocity: number): void {
    const context = this.audioContext;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(150, time);
    oscillator.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    gain.gain.setValueAtTime(velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.16);

    oscillator.connect(gain).connect(this.target());
    oscillator.start(time);
    oscillator.stop(time + 0.18);
    this.track(oscillator, gain);
  }

  private scheduleSnare(time: number, velocity: number): void {
    this.scheduleSnareBody(time, velocity);
    this.scheduleSnareWires(time, velocity);
    this.scheduleTone(time, 0.035, 240, velocity * 0.22, "triangle");
  }

  private scheduleBuzzRoll(time: number, duration: number, velocity: number): void {
    const context = this.audioContext;
    const clippedDuration = Math.max(0.06, Math.min(3, duration));
    const bufferSize = Math.max(1, Math.floor(context.sampleRate * clippedDuration));
    const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i += 1) {
      const progress = i / bufferSize;
      const tremor = 0.72 + Math.sin(progress * Math.PI * 2 * clippedDuration * 42) * 0.28;
      data[i] = (Math.random() * 2 - 1) * tremor;
    }

    const source = context.createBufferSource();
    const bandpass = context.createBiquadFilter();
    const highpass = context.createBiquadFilter();
    const gain = context.createGain();
    const attack = Math.min(0.018, clippedDuration * 0.18);
    const releaseStart = Math.max(time + attack, time + clippedDuration - Math.min(0.055, clippedDuration * 0.35));

    source.buffer = buffer;
    bandpass.type = "bandpass";
    bandpass.frequency.setValueAtTime(1850, time);
    bandpass.Q.setValueAtTime(0.75, time);
    highpass.type = "highpass";
    highpass.frequency.setValueAtTime(520, time);
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(velocity * 0.62, time + attack);
    gain.gain.setValueAtTime(velocity * 0.55, releaseStart);
    gain.gain.exponentialRampToValueAtTime(0.001, time + clippedDuration);

    source.connect(bandpass).connect(highpass).connect(gain).connect(this.target());
    source.start(time);
    source.stop(time + clippedDuration + 0.02);
    this.track(source, bandpass, highpass, gain);
  }

  private scheduleSnareBody(time: number, velocity: number): void {
    const context = this.audioContext;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(245, time);
    oscillator.frequency.exponentialRampToValueAtTime(175, time + 0.09);
    gain.gain.setValueAtTime(velocity * 0.34, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);

    oscillator.connect(gain).connect(this.target());
    oscillator.start(time);
    oscillator.stop(time + 0.14);
    this.track(oscillator, gain);
  }

  private scheduleSnareWires(time: number, velocity: number): void {
    const context = this.audioContext;
    const duration = 0.22;
    const bufferSize = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = context.createBufferSource();
    const bandpass = context.createBiquadFilter();
    const highpass = context.createBiquadFilter();
    const gain = context.createGain();

    source.buffer = buffer;
    bandpass.type = "bandpass";
    bandpass.frequency.setValueAtTime(1800, time);
    bandpass.Q.setValueAtTime(0.9, time);
    highpass.type = "highpass";
    highpass.frequency.setValueAtTime(650, time);
    gain.gain.setValueAtTime(velocity * 0.95, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    source.connect(bandpass).connect(highpass).connect(gain).connect(this.target());
    source.start(time);
    source.stop(time + duration + 0.02);
    this.track(source, bandpass, highpass, gain);
  }

  private scheduleTom(time: number, frequency: number, velocity: number): void {
    const context = this.audioContext;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, time);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.62, time + 0.18);
    gain.gain.setValueAtTime(velocity * 0.7, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.28);

    oscillator.connect(gain).connect(this.target());
    oscillator.start(time);
    oscillator.stop(time + 0.3);
    this.track(oscillator, gain);
  }

  private scheduleCowbell(time: number, velocity: number): void {
    this.scheduleTone(time, 0.18, 540, velocity * 0.35, "square");
    this.scheduleTone(time, 0.16, 800, velocity * 0.25, "square");
  }

  private scheduleClick(time: number, velocity: number): void {
    this.scheduleTone(time, 0.045, 1800, velocity * 0.35, "triangle");
  }

  private scheduleMetal(time: number, duration: number, frequency: number, velocity: number): void {
    this.scheduleTone(time, duration, frequency, velocity, "square");
    this.scheduleTone(time, duration * 0.8, frequency * 1.36, velocity * 0.55, "square");
  }

  private scheduleTone(
    time: number,
    duration: number,
    frequency: number,
    velocity: number,
    type: OscillatorType
  ): void {
    const context = this.audioContext;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, time);
    gain.gain.setValueAtTime(velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    oscillator.connect(gain).connect(this.target());
    oscillator.start(time);
    oscillator.stop(time + duration + 0.02);
    this.track(oscillator, gain);
  }

  private scheduleNoise(time: number, duration: number, frequency: number, velocity: number): void {
    this.scheduleFilteredNoise(time, duration, "highpass", frequency, velocity, 1);
  }

  private scheduleFilteredNoise(
    time: number,
    duration: number,
    filterType: BiquadFilterType,
    frequency: number,
    velocity: number,
    q = 1
  ): void {
    const context = this.audioContext;
    const bufferSize = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();

    source.buffer = buffer;
    filter.type = filterType;
    filter.frequency.setValueAtTime(frequency, time);
    filter.Q.setValueAtTime(q, time);
    gain.gain.setValueAtTime(velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    source.connect(filter).connect(gain).connect(this.target());
    source.start(time);
    source.stop(time + duration + 0.02);
    this.track(source, filter, gain);
  }

  private target(): AudioNode {
    return this.master ?? this.audioContext.destination;
  }

  private track<T extends AudioScheduledSourceNode>(source: T, ...nodes: AudioNode[]): T {
    this.sources.push(source);
    this.nodes.push(source, ...nodes);
    return source;
  }
}
