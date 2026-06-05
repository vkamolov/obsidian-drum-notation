import { getSecondsPerSlot, getSlotVisualDurationSeconds } from "./music";
import { DrumSynth } from "./synth";
import { DEFAULT_REPEAT_COUNT, DrumBlock, DrumSlot, PlaybackOptions } from "./types";

export class DrumPlayer {
  private synth: DrumSynth | null = null;
  private timers: number[] = [];
  private stopped = false;
  private secondsPerSlot = 0;
  private playbackStartTime = 0;
  private playStartSlot = 0;
  private playEndSlot = 0;
  private playSlots: DrumSlot[] = [];
  private passDurationSeconds = 0;

  constructor(
    private readonly audioContext: AudioContext,
    private readonly block: DrumBlock,
    private readonly onEnded: () => void,
    private readonly onSlotChange: (slotIndex: number) => void,
    private readonly options: PlaybackOptions = {}
  ) {}

  async play(): Promise<void> {
    const synth = new DrumSynth(this.audioContext);

    this.synth = synth;
    await synth.start();

    if (this.stopped || this.synth !== synth) {
      return;
    }

    this.playStartSlot = this.options.startSlot ?? 0;
    this.playEndSlot = Math.min(this.options.endSlot ?? this.block.slots.length, this.block.slots.length);
    this.playSlots = this.block.slots.slice(this.playStartSlot, this.playEndSlot);
    this.secondsPerSlot = getSecondsPerSlot(this.block);
    this.passDurationSeconds = this.playSlots.length * this.secondsPerSlot;
    this.playbackStartTime = synth.currentTime + 0.08;

    if (this.playSlots.length === 0) {
      this.stop();
      this.onEnded();
      return;
    }

    this.schedulePass(0);
  }

  private schedulePass(passIndex: number): void {
    if (!this.synth || this.stopped) {
      return;
    }

    const repeatCount = this.options.loop ? Number.POSITIVE_INFINITY : this.options.repeatCount ?? DEFAULT_REPEAT_COUNT;
    const passStartTime = this.playbackStartTime + passIndex * this.passDurationSeconds;

    this.timers.push(
      window.setTimeout(() => {
        if (!this.stopped) {
          this.onSlotChange(this.playStartSlot);
        }
      }, Math.max(0, (passStartTime - this.synth.currentTime) * 1000))
    );

    this.playSlots.forEach((slot) => {
      const slotTime = passStartTime + (slot.index - this.playStartSlot) * this.secondsPerSlot;
      if (slot.hits.length > 0) {
        this.timers.push(
          window.setTimeout(() => {
            if (!this.stopped) {
              this.onSlotChange(slot.index);
            }
          }, Math.max(0, (slotTime - this.synth!.currentTime) * 1000))
        );
      }
      this.synth?.scheduleHits(slot.hits, slotTime, this.secondsPerSlot, getSlotVisualDurationSeconds(this.block, slot));
    });

    this.timers.push(
      window.setTimeout(() => {
        if (this.stopped) {
          return;
        }

        if (this.options.loop || passIndex + 1 < repeatCount) {
          this.schedulePass(passIndex + 1);
        } else {
          this.stop();
          this.onEnded();
        }
      }, Math.max(0, (passStartTime + this.passDurationSeconds - this.synth.currentTime) * 1000))
    );
  }

  stop(): void {
    this.stopped = true;
    this.timers.forEach((timer) => window.clearTimeout(timer));
    this.timers = [];

    this.synth?.stop();
    this.synth = null;
  }
}
