import {
  getRangeDurationSeconds,
  getSecondsPerQuarter,
  getSlotBoundaryQuarter,
  getSlotDurationSeconds,
  getSlotIndexAtQuarter,
  getSlotVisualDurationSeconds
} from "./music";
import {
  DrumPlaybackBackend,
  DrumPlaybackBackendFactory,
  createMetronomeHit,
  filterMutedHits,
  getCountInDurationQuarter,
  getCountInPulses,
  getMetronomePulses,
  normalizePlaybackSpeedPercent
} from "./playback";
import { createSynthPlaybackBackend } from "./synth";
import { DEFAULT_REPEAT_COUNT, DrumBlock, PlaybackOptions } from "./types";

export class DrumPlayer {
  private backend: DrumPlaybackBackend | null = null;
  private timers: number[] = [];
  private stopped = false;
  private secondsPerQuarter = 0;
  private playbackStartTime = 0;
  private rangeStartSlot = 0;
  private rangeEndSlot = 0;
  private initialSlot = 0;
  private firstPassDurationSeconds = 0;
  private fullPassDurationSeconds = 0;
  private countInDurationSeconds = 0;

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

    this.secondsPerQuarter = getSecondsPerQuarter(this.block, speedPercent);
    this.countInDurationSeconds =
      getCountInDurationQuarter(
        this.block,
        this.options.countInMode ?? "off",
        this.initialSlot
      ) *
      this.secondsPerQuarter;
    this.firstPassDurationSeconds = getRangeDurationSeconds(
      this.block,
      this.initialSlot,
      this.rangeEndSlot,
      speedPercent
    );
    this.fullPassDurationSeconds = getRangeDurationSeconds(
      this.block,
      this.rangeStartSlot,
      this.rangeEndSlot,
      speedPercent
    );
    const transportStartTime = backend.currentTime + 0.08;
    this.playbackStartTime = transportStartTime + this.countInDurationSeconds;

    if (this.rangeEndSlot <= this.rangeStartSlot) {
      this.stop();
      this.onEnded();
      return;
    }

    this.scheduleCountIn(transportStartTime, backend);
    this.schedulePass(0);
  }

  private scheduleCountIn(transportStartTime: number, backend: DrumPlaybackBackend): void {
    const countInPulses = getCountInPulses(
      this.block,
      this.options.countInMode ?? "off",
      this.initialSlot
    );

    countInPulses.forEach((pulse) => {
      backend.scheduleHits(
        [createMetronomeHit(pulse.isDownbeat)],
        transportStartTime + pulse.quarterOffset * this.secondsPerQuarter,
        pulse.intervalQuarter * this.secondsPerQuarter,
        pulse.intervalQuarter * this.secondsPerQuarter
      );
    });
  }

  private schedulePass(passIndex: number): void {
    if (!this.backend || this.stopped) {
      return;
    }

    const repeatCount = this.options.loop ? Number.POSITIVE_INFINITY : this.options.repeatCount ?? DEFAULT_REPEAT_COUNT;
    const passStartSlot = passIndex === 0 ? this.initialSlot : this.rangeStartSlot;
    const passSlots = this.block.slots.slice(passStartSlot, this.rangeEndSlot);
    const passDurationSeconds = getRangeDurationSeconds(
      this.block,
      passStartSlot,
      this.rangeEndSlot,
      this.options.speedPercent ?? 100
    );
    const passStartQuarter = getSlotBoundaryQuarter(this.block, passStartSlot);
    const passStartTime =
      passIndex === 0
        ? this.playbackStartTime
        : this.playbackStartTime + this.firstPassDurationSeconds + (passIndex - 1) * this.fullPassDurationSeconds;
    const backend = this.backend;
    const metronomeMode = this.options.metronomeMode ?? "off";

    this.timers.push(
      window.setTimeout(() => {
        if (!this.stopped) {
          this.onSlotChange(passStartSlot);
        }
      }, Math.max(0, (passStartTime - backend.currentTime) * 1000))
    );
    this.scheduleBarChanges(passStartSlot, passStartTime, backend);

    passSlots.forEach((slot) => {
      const slotTime =
        passStartTime +
        (slot.startQuarter - passStartQuarter) * this.secondsPerQuarter;
      const writtenHits =
        metronomeMode === "metronome-only"
          ? []
          : filterMutedHits(slot.hits, this.options.mutedInstrumentIds);

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
        writtenHits,
        slotTime,
        getSlotDurationSeconds(
          this.block,
          slot,
          normalizePlaybackSpeedPercent(this.options.speedPercent ?? 100)
        ),
        getSlotVisualDurationSeconds(
          this.block,
          slot,
          normalizePlaybackSpeedPercent(this.options.speedPercent ?? 100)
        )
      );
    });

    if (metronomeMode !== "off") {
      getMetronomePulses(
        this.block,
        passStartSlot,
        this.rangeEndSlot
      ).forEach((pulse) => {
        const pulseTime =
          passStartTime +
          (pulse.quarterOffset - passStartQuarter) * this.secondsPerQuarter;

        backend.scheduleHits(
          [createMetronomeHit(pulse.isDownbeat)],
          pulseTime,
          pulse.intervalQuarter * this.secondsPerQuarter,
          pulse.intervalQuarter * this.secondsPerQuarter
        );
      });
    }

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

  private scheduleBarChanges(
    passStartSlot: number,
    passStartTime: number,
    backend: DrumPlaybackBackend
  ): void {
    const onBarChange = this.options.onBarChange;

    if (!onBarChange) {
      return;
    }

    const activeBarIndex = barIndexForSlot(this.block, passStartSlot);
    const activeBar = this.block.bars[activeBarIndex];

    if (!activeBar) {
      return;
    }

    this.timers.push(
      window.setTimeout(() => {
        if (!this.stopped) {
          onBarChange(activeBarIndex);
        }
      }, Math.max(0, (passStartTime - backend.currentTime) * 1000))
    );

    for (let barIndex = activeBarIndex + 1; barIndex < this.block.bars.length; barIndex++) {
      const barStartSlot = this.block.bars[barIndex].startSlot;

      if (barStartSlot >= this.rangeEndSlot) {
        break;
      }

      if (barStartSlot <= passStartSlot || barStartSlot < this.rangeStartSlot) {
        continue;
      }

      const barStartTime =
        passStartTime +
        (this.block.bars[barIndex].startQuarter -
          getSlotBoundaryQuarter(this.block, passStartSlot)) *
          this.secondsPerQuarter;

      this.timers.push(
        window.setTimeout(() => {
          if (!this.stopped) {
            onBarChange(barIndex);
          }
        }, Math.max(0, (barStartTime - backend.currentTime) * 1000))
      );
    }
  }

  getCurrentSlotIndex(): number {
    if (this.rangeEndSlot <= this.rangeStartSlot) {
      return this.rangeStartSlot;
    }

    if (!this.backend || this.backend.currentTime <= this.playbackStartTime || this.secondsPerQuarter <= 0) {
      return this.initialSlot;
    }

    const elapsed = this.backend.currentTime - this.playbackStartTime;

    if (elapsed < this.firstPassDurationSeconds) {
      return getSlotIndexAtQuarter(
        this.block,
        getSlotBoundaryQuarter(this.block, this.initialSlot) +
          elapsed / this.secondsPerQuarter,
        this.initialSlot,
        this.rangeEndSlot
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

    return getSlotIndexAtQuarter(
      this.block,
      getSlotBoundaryQuarter(this.block, this.rangeStartSlot) +
        elapsedInPass / this.secondsPerQuarter,
      this.rangeStartSlot,
      this.rangeEndSlot
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

function barIndexForSlot(block: DrumBlock, slotIndex: number): number {
  const index = block.bars.findIndex(
    (bar) => slotIndex >= bar.startSlot && slotIndex < bar.startSlot + bar.slots.length
  );

  return index >= 0 ? index : 0;
}
