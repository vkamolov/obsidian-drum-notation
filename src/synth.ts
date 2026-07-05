import { DrumHit, DrumPlaybackKind } from "./types";
import { DrumPlaybackBackend, DrumPlaybackBackendFactory } from "./playback";

export class DrumSynth implements DrumPlaybackBackend {
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

    this.scheduleInstrumentHit(hit, time);
  }

  private scheduleInstrumentHit(hit: DrumHit, time: number): void {
    if (hit.articulation !== "accent") {
      this.scheduleInstrument(hit.instrument.playback, time, hit.velocity);
      return;
    }

    switch (hit.instrument.playback) {
      case "hatClosed":
        this.scheduleAccentedClosedHat(time, hit.velocity);
        break;
      case "hatHalfOpen":
        this.scheduleAccentedHalfOpenHat(time, hit.velocity);
        break;
      case "hatOpen":
        this.scheduleAccentedOpenHat(time, hit.velocity);
        break;
      case "hatFoot":
        this.scheduleAccentedFootHat(time, hit.velocity);
        break;
      case "hatFootSplash":
        this.scheduleAccentedFootSplash(time, hit.velocity);
        break;
      default:
        this.scheduleInstrument(hit.instrument.playback, time, hit.velocity);
        break;
    }
  }

  private scheduleChokedInstrument(playback: DrumPlaybackKind, time: number, velocity: number): void {
    switch (playback) {
      case "crash":
        this.scheduleFilteredNoise(time, 0.12, "highpass", 4500, velocity * 0.5, 0.8);
        this.scheduleMetallicShimmer(time, 0.09, velocity * 0.12, 5800);
        break;
      case "splash":
        this.scheduleFilteredNoise(time, 0.1, "highpass", 6400, velocity * 0.44, 0.65);
        this.scheduleMetallicShimmer(time, 0.08, velocity * 0.08, 7000);
        break;
      case "china":
        this.scheduleFilteredNoise(time, 0.13, "bandpass", 1900, velocity * 0.56, 1.1);
        this.scheduleFilteredNoise(time, 0.1, "highpass", 3600, velocity * 0.2, 0.55);
        break;
      case "stack":
        this.scheduleFilteredNoise(time, 0.08, "bandpass", 3100, velocity * 0.52, 2.2);
        this.scheduleMetallicShimmer(time, 0.06, velocity * 0.08, 6400);
        break;
      case "ride":
        this.scheduleFilteredNoise(time, 0.11, "highpass", 6400, velocity * 0.26, 0.7);
        this.scheduleTone(time, 0.08, 2300, velocity * 0.18, "triangle");
        break;
      case "rideBell":
        this.scheduleRideBellChoke(time, velocity);
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
        this.scheduleMetallicShimmer(time, 0.045, velocity * 0.1, 7800);
        break;
      case "hatHalfOpen":
        this.scheduleFilteredNoise(time, 0.14, "highpass", 6600, velocity * 0.5, 0.9);
        this.scheduleMetallicShimmer(time, 0.13, velocity * 0.1, 7400);
        this.scheduleClick(time, velocity * 0.12);
        break;
      case "hatOpen":
        this.scheduleNoise(time, 0.24, 6200, velocity * 0.5);
        this.scheduleMetallicShimmer(time, 0.22, velocity * 0.12, 7000);
        break;
      case "hatFoot":
        this.scheduleNoise(time, 0.08, 5200, velocity * 0.35);
        this.scheduleMetallicShimmer(time, 0.05, velocity * 0.06, 7200);
        this.scheduleClick(time, velocity * 0.25);
        break;
      case "hatFootSplash":
        this.scheduleFilteredNoise(time, 0.22, "highpass", 5600, velocity * 0.42, 0.75);
        this.scheduleMetallicShimmer(time, 0.18, velocity * 0.08, 6800);
        this.scheduleClick(time, velocity * 0.18);
        break;
      case "ride":
        this.scheduleRide(time, velocity);
        break;
      case "rideBell":
        this.scheduleRideBell(time, velocity);
        break;
      case "crash":
        this.scheduleCrash(time, velocity);
        break;
      case "splash":
        this.scheduleFilteredNoise(time, 0.36, "highpass", 6200, velocity * 0.46, 0.65);
        this.scheduleMetallicShimmer(time, 0.3, velocity * 0.14, 6800);
        break;
      case "china":
        this.scheduleFilteredNoise(time, 0.95, "bandpass", 1900, velocity * 0.62, 1.1);
        this.scheduleFilteredNoise(time, 0.62, "highpass", 3600, velocity * 0.24, 0.55);
        this.scheduleMetallicShimmer(time, 0.7, velocity * 0.18, 4200);
        break;
      case "stack":
        this.scheduleFilteredNoise(time, 0.18, "bandpass", 3100, velocity * 0.58, 2.2);
        this.scheduleFilteredNoise(time, 0.12, "highpass", 7600, velocity * 0.28, 0.8);
        this.scheduleMetallicShimmer(time, 0.12, velocity * 0.12, 6200);
        break;
      case "cowbell":
        this.scheduleCowbell(time, velocity);
        break;
      case "click":
        this.scheduleClick(time, velocity);
        break;
    }
  }

  private scheduleAccentedClosedHat(time: number, velocity: number): void {
    this.scheduleFilteredNoise(time, 0.06, "highpass", 7600, velocity * 0.72, 1.05);
    this.scheduleMetallicShimmer(time, 0.055, velocity * 0.14, 8000);
  }

  private scheduleAccentedHalfOpenHat(time: number, velocity: number): void {
    this.scheduleFilteredNoise(time, 0.18, "highpass", 7200, velocity * 0.62, 1.05);
    this.scheduleMetallicShimmer(time, 0.16, velocity * 0.12, 7600);
    this.scheduleClick(time, velocity * 0.18);
  }

  private scheduleAccentedOpenHat(time: number, velocity: number): void {
    this.scheduleFilteredNoise(time, 0.3, "highpass", 6800, velocity * 0.62, 0.9);
    this.scheduleMetallicShimmer(time, 0.26, velocity * 0.14, 7200);
    this.scheduleClick(time, velocity * 0.1);
  }

  private scheduleAccentedFootHat(time: number, velocity: number): void {
    this.scheduleNoise(time, 0.09, 5800, velocity * 0.46);
    this.scheduleMetallicShimmer(time, 0.06, velocity * 0.08, 7400);
    this.scheduleClick(time, velocity * 0.34);
  }

  private scheduleAccentedFootSplash(time: number, velocity: number): void {
    this.scheduleFilteredNoise(time, 0.26, "highpass", 6200, velocity * 0.52, 0.85);
    this.scheduleMetallicShimmer(time, 0.2, velocity * 0.1, 7000);
    this.scheduleClick(time, velocity * 0.24);
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

    // Beater attack: a tiny dark noise tap gives the hit definition without
    // changing the fundamental's character.
    this.scheduleFilteredNoise(time, 0.02, "bandpass", 3000, velocity * 0.12, 0.8);
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

    // First membrane overtone (~1.59x on an ideal head) plus a short stick
    // tap: a lone sine sweep reads as an electronic blip rather than a drum.
    this.scheduleTone(time, 0.08, frequency * 1.59, velocity * 0.16, "sine");
    this.scheduleFilteredNoise(time, 0.025, "bandpass", 2600, velocity * 0.18, 1);
  }

  private scheduleCowbell(time: number, velocity: number): void {
    this.scheduleTone(time, 0.18, 540, velocity * 0.35, "square");
    this.scheduleTone(time, 0.16, 800, velocity * 0.25, "square");
  }

  private scheduleRide(time: number, velocity: number): void {
    // The stick ping on a real ride is genuinely pitched, so its partials stay
    // fixed between hits; only the noise wash drifts a little. Randomizing the
    // tone frequencies makes consecutive hits play recognizably different
    // notes (the flaw that made the old crash sound like a xylophone).
    const drift = 0.97 + Math.random() * 0.06;

    this.scheduleTone(time, 0.065, 2550, velocity * 0.28, "triangle");
    this.scheduleTone(time, 0.11, 3820, velocity * 0.13, "sine");
    this.scheduleFilteredNoiseEnvelope(time, 0.34, "highpass", 7200 * drift, velocity * 0.16, 0.72, 0.006);
    this.scheduleFilteredNoiseEnvelope(time + 0.01, 0.58, "bandpass", 5200 * drift, velocity * 0.08, 0.9, 0.012);
    this.scheduleMetallicShimmer(time, 0.5, velocity * 0.05, 7600);
  }

  private scheduleRideBell(time: number, velocity: number): void {
    // A bell strike is pitched and does not change pitch between hits.
    const drift = 0.985 + Math.random() * 0.03;

    this.scheduleTone(time, 0.18, 2850, velocity * 0.42, "triangle");
    this.scheduleTone(time, 0.13, 4020, velocity * 0.24, "sine");
    this.scheduleTone(time, 0.09, 5750, velocity * 0.12, "sine");
    this.scheduleFilteredNoiseEnvelope(time, 0.24, "highpass", 8600 * drift, velocity * 0.1, 0.8, 0.004);
  }

  private scheduleRideBellChoke(time: number, velocity: number): void {
    const drift = 0.985 + Math.random() * 0.03;

    this.scheduleTone(time, 0.08, 2850, velocity * 0.34, "triangle");
    this.scheduleTone(time, 0.06, 4020, velocity * 0.16, "sine");
    this.scheduleFilteredNoiseEnvelope(time, 0.09, "highpass", 8200 * drift, velocity * 0.08, 0.75, 0.004);
  }

  private scheduleCrash(time: number, velocity: number): void {
    // Per-hit variation lives only on noise-filter cutoffs, where ±3% keeps
    // repeated crashes from sounding machine-identical without any pitch
    // change. The old voice randomized two audible triangle tones instead,
    // which read as a cowbell/xylophone playing a different note every hit.
    const drift = 0.97 + Math.random() * 0.06;

    this.scheduleFilteredNoiseEnvelope(time, 0.42, "highpass", 5200 * drift, velocity * 0.5, 0.6, 0.003);
    this.scheduleFilteredNoiseEnvelope(time + 0.01, 1.65, "highpass", 3300 * drift, velocity * 0.46, 0.55, 0.03);
    this.scheduleFilteredNoiseEnvelope(time + 0.02, 1.1, "bandpass", 2300 * drift, velocity * 0.26, 0.8, 0.05);
    this.scheduleMetallicShimmer(time, 0.85, velocity * 0.16, 5600);
  }

  // Six inharmonic square oscillators through a shared highpass — the classic
  // analog-cymbal technique. Only the dense upper harmonics survive the
  // filter, so the cluster contributes metallic sheen with no single audible
  // pitch (unlike discrete tones, which read as cowbell/xylophone).
  private scheduleMetallicShimmer(
    time: number,
    duration: number,
    velocity: number,
    highpassFrequency: number
  ): void {
    const context = this.audioContext;
    const frequencies = [205.3, 304.4, 369.6, 522.7, 540, 800];
    const highpass = context.createBiquadFilter();
    const gain = context.createGain();

    highpass.type = "highpass";
    highpass.frequency.setValueAtTime(highpassFrequency, time);
    gain.gain.setValueAtTime(velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    highpass.connect(gain).connect(this.target());
    this.nodes.push(highpass, gain);

    frequencies.forEach((frequency) => {
      const oscillator = context.createOscillator();

      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(frequency, time);
      oscillator.connect(highpass);
      oscillator.start(time);
      oscillator.stop(time + duration + 0.02);
      this.track(oscillator);
    });
  }

  private scheduleClick(time: number, velocity: number): void {
    this.scheduleTone(time, 0.045, 1800, velocity * 0.35, "triangle");
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

  private scheduleFilteredNoiseEnvelope(
    time: number,
    duration: number,
    filterType: BiquadFilterType,
    frequency: number,
    velocity: number,
    q = 1,
    attack = 0.01
  ): void {
    const context = this.audioContext;
    const clippedDuration = Math.max(attack + 0.02, duration);
    const bufferSize = Math.max(1, Math.floor(context.sampleRate * clippedDuration));
    const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const attackEnd = time + Math.min(attack, clippedDuration * 0.45);

    source.buffer = buffer;
    filter.type = filterType;
    filter.frequency.setValueAtTime(frequency, time);
    filter.Q.setValueAtTime(q, time);
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(velocity, attackEnd);
    gain.gain.exponentialRampToValueAtTime(0.001, time + clippedDuration);

    source.connect(filter).connect(gain).connect(this.target());
    source.start(time);
    source.stop(time + clippedDuration + 0.02);
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

export const createSynthPlaybackBackend: DrumPlaybackBackendFactory = (audioContext) => new DrumSynth(audioContext);
