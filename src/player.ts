import { getSecondsPerSlot, getSlotVisualDurationSeconds } from "./music";
import {
  DrumPlaybackBackend,
  DrumPlaybackBackendFactory,
  filterMutedHits,
  normalizePlaybackSpeedPercent
} from "./playback";
import { createSynthPlaybackBackend } from "./synth";
import { DEFAULT_REPEAT_COUNT, DrumBlock, PlaybackOptions } from "./types";

export class DrumPlayer {
  private backend: DrumPlaybackBackend | null = null;
  private timers: number[] = [];
  private stopped = false;
  private secondsPerSlot = 0;
  private playbackStartTime = 0;
  private rangeStartSlot = 0;
  private rangeEndSlot = 0;
  private initialSlot = 0;
  private firstPassDurationSeconds = 0;
  private fullPassDurationSeconds = 0;

  constructor(
    private readonly audioContext: AudioContext,
    private readonly block: DrumBlock,
    private readonly onEnded: () => void,
    private readonly onSlotChange: (slotIndex: number) => void,
    private readonly options: PlaybackOptions = {},
    private readonly createPlaybackBackend: DrumPlaybackBackendFactory = createSynthPlaybackBackend
  ) {}

  async play(): Promise<void> {
    const backend = this.createPlaybackBackend(this.audioContext);

    this.backend = backend;
    await backend.start();

    if (this.stopped || this.backend !== backend) {
      return;
    }

    this.rangeStartSlot = clampSlotBoundary(this.options.startSlot ?? 0, this.block.slots.length);
    this.rangeEndSlot = Math.min(
      Math.max(this.rangeStartSlot, this.options.endSlot ?? this.block.slots.length),
      this.block.slots.length
    );
    this.initialSlot = clampInitialSlot(
      this.options.initialSlot ?? this.rangeStartSlot,
      this.rangeStartSlot,
      this.rangeEndSlot
    );
    const speedPercent = normalizePlaybackSpeedPercent(this.options.speedPercent ?? 100);

    this.secondsPerSlot = getSecondsPerSlot(this.block, speedPercent);
    this.firstPassDurationSeconds = (this.rangeEndSlot - this.initialSlot) * this.secondsPerSlot;
    this.fullPassDurationSeconds = (this.rangeEndSlot - this.rangeStartSlot) * this.secondsPerSlot;
    this.playbackStartTime = backend.currentTime + 0.08;

    if (this.rangeEndSlot <= this.rangeStartSlot) {
      this.stop();
      this.onEnded();
      return;
    }

    this.schedulePass(0);
  }

  private schedulePass(passIndex: number): void {
    if (!this.backend || this.stopped) {
      return;
    }

    const repeatCount = this.options.loop ? Number.POSITIVE_INFINITY : this.options.repeatCount ?? DEFAULT_REPEAT_COUNT;
    const passStartSlot = passIndex === 0 ? this.initialSlot : this.rangeStartSlot;
    const passSlots = this.block.slots.slice(passStartSlot, this.rangeEndSlot);
    const passDurationSeconds = passSlots.length * this.secondsPerSlot;
    const passStartTime =
      passIndex === 0
        ? this.playbackStartTime
        : this.playbackStartTime + this.firstPassDurationSeconds + (passIndex - 1) * this.fullPassDurationSeconds;
    const backend = this.backend;

    this.timers.push(
      window.setTimeout(() => {
        if (!this.stopped) {
          this.onSlotChange(passStartSlot);
        }
      }, Math.max(0, (passStartTime - backend.currentTime) * 1000))
    );

    passSlots.forEach((slot) => {
      const slotTime = passStartTime + (slot.index - passStartSlot) * this.secondsPerSlot;
      if (slot.hits.length > 0) {
        this.timers.push(
          window.setTimeout(() => {
            if (!this.stopped) {
              this.onSlotChange(slot.index);
            }
          }, Math.max(0, (slotTime - backend.currentTime) * 1000))
        );
      }
      backend.scheduleHits(
        filterMutedHits(slot.hits, this.options.mutedInstrumentIds),
        slotTime,
        this.secondsPerSlot,
        getSlotVisualDurationSeconds(
          this.block,
          slot,
          normalizePlaybackSpeedPercent(this.options.speedPercent ?? 100)
        )
      );
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
      }, Math.max(0, (passStartTime + passDurationSeconds - backend.currentTime) * 1000))
    );
  }

  getCurrentSlotIndex(): number {
    if (this.rangeEndSlot <= this.rangeStartSlot) {
      return this.rangeStartSlot;
    }

    if (!this.backend || this.backend.currentTime <= this.playbackStartTime || this.secondsPerSlot <= 0) {
      return this.initialSlot;
    }

    const elapsed = this.backend.currentTime - this.playbackStartTime;

    if (elapsed < this.firstPassDurationSeconds) {
      return Math.min(
        this.rangeEndSlot - 1,
        this.initialSlot + Math.floor(elapsed / this.secondsPerSlot)
      );
    }

    const repeatCount = this.options.loop
      ? Number.POSITIVE_INFINITY
      : this.options.repeatCount ?? DEFAULT_REPEAT_COUNT;
    const elapsedAfterFirstPass = elapsed - this.firstPassDurationSeconds;
    const completedFullPasses = Math.floor(elapsedAfterFirstPass / this.fullPassDurationSeconds);

    if (!this.options.loop && completedFullPasses >= repeatCount - 1) {
      return this.rangeEndSlot - 1;
    }

    const elapsedInPass = elapsedAfterFirstPass % this.fullPassDurationSeconds;

    return Math.min(
      this.rangeEndSlot - 1,
      this.rangeStartSlot + Math.floor(elapsedInPass / this.secondsPerSlot)
    );
  }

  stop(): void {
    this.stopped = true;
    this.timers.forEach((timer) => window.clearTimeout(timer));
    this.timers = [];

    this.backend?.stop();
    this.backend = null;
  }
}

function clampSlotBoundary(slotIndex: number, slotCount: number): number {
  return Math.min(slotCount, Math.max(0, Math.round(slotIndex)));
}

function clampInitialSlot(slotIndex: number, startSlot: number, endSlot: number): number {
  if (endSlot <= startSlot) {
    return startSlot;
  }

  return Math.min(endSlot - 1, Math.max(startSlot, Math.round(slotIndex)));
}
