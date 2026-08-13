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
import { DEFAULT_REPEAT_COUNT, DrumBlock, DrumPlaybackPosition, PlaybackOptions } from "./types";

export interface PlaybackRoadmapEntry {
  barIndex: number;
  startSlot: number;
  endSlot: number;
  sectionTraversal: 0 | 1 | 2;
}

interface ScheduledOccurrence extends PlaybackRoadmapEntry {
  roadmapEntryIndex: number;
  blockPassIndex: number;
  startTime: number;
  endTime: number;
}

export function buildPlaybackRoadmap(
  block: DrumBlock,
  startSlot = 0,
  endSlot = block.slots.length,
  respectSectionRepeats = true
): PlaybackRoadmapEntry[] {
  const rangeStart = clampSlotBoundary(startSlot, block.slots.length);
  const rangeEnd = Math.min(
    Math.max(rangeStart, Math.round(endSlot)),
    block.slots.length
  );
  const bars = block.bars
    .map((bar, barIndex) => ({ bar, barIndex }))
    .filter(({ bar }) =>
      bar.startSlot < rangeEnd && bar.startSlot + bar.slots.length > rangeStart
    );
  const firstBarIndex = bars[0]?.barIndex ?? 0;
  const lastBarIndex = bars[bars.length - 1]?.barIndex ?? -1;
  const repeatsByStart = new Map(
    block.sectionRepeats
      .filter((repeat) =>
        respectSectionRepeats &&
        repeat.startBarIndex >= firstBarIndex &&
        repeat.endBarIndex <= lastBarIndex
      )
      .map((repeat) => [repeat.startBarIndex, repeat])
  );
  const result: PlaybackRoadmapEntry[] = [];

  const appendBar = (barIndex: number, sectionTraversal: 0 | 1 | 2) => {
    const bar = block.bars[barIndex];
    if (!bar) {
      return;
    }

    const entryStart = Math.max(rangeStart, bar.startSlot);
    const entryEnd = Math.min(rangeEnd, bar.startSlot + bar.slots.length);
    if (entryEnd > entryStart) {
      result.push({ barIndex, startSlot: entryStart, endSlot: entryEnd, sectionTraversal });
    }
  };

  for (let barIndex = firstBarIndex; barIndex <= lastBarIndex; barIndex++) {
    const repeat = repeatsByStart.get(barIndex);
    if (!repeat) {
      appendBar(barIndex, 0);
      continue;
    }

    for (const traversal of [1, 2] as const) {
      for (let repeatedBarIndex = repeat.startBarIndex; repeatedBarIndex <= repeat.endBarIndex; repeatedBarIndex++) {
        appendBar(repeatedBarIndex, traversal);
      }
    }
    barIndex = repeat.endBarIndex;
  }

  return result;
}

export class DrumPlayer {
  private backend: DrumPlaybackBackend | null = null;
  private timers: number[] = [];
  private stopped = false;
  private secondsPerQuarter = 0;
  private playbackStartTime = 0;
  private rangeStartSlot = 0;
  private rangeEndSlot = 0;
  private initialSlot = 0;
  private roadmap: PlaybackRoadmapEntry[] = [];
  private scheduledOccurrences: ScheduledOccurrence[] = [];

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
      this.options.initialPosition?.slotIndex ?? this.options.initialSlot ?? this.rangeStartSlot,
      this.rangeStartSlot,
      this.rangeEndSlot
    );
    const isWholeBlockRange =
      this.rangeStartSlot === 0 && this.rangeEndSlot === this.block.slots.length;
    this.roadmap = buildPlaybackRoadmap(
      this.block,
      this.rangeStartSlot,
      this.rangeEndSlot,
      isWholeBlockRange
    );

    if (this.rangeEndSlot <= this.rangeStartSlot || this.roadmap.length === 0) {
      this.stop();
      this.onEnded();
      return;
    }

    const speedPercent = normalizePlaybackSpeedPercent(this.options.speedPercent ?? 100);
    this.secondsPerQuarter = getSecondsPerQuarter(this.block, speedPercent);
    const countInDurationSeconds =
      getCountInDurationQuarter(
        this.block,
        this.options.countInMode ?? "off",
        this.initialSlot
      ) * this.secondsPerQuarter;
    const transportStartTime = backend.currentTime + 0.08;
    this.playbackStartTime = transportStartTime + countInDurationSeconds;

    this.scheduleCountIn(transportStartTime, backend);

    const initial = this.resolveInitialPosition();
    this.scheduleBlockPass(
      initial.blockPassIndex,
      initial.roadmapEntryIndex,
      initial.slotIndex,
      this.playbackStartTime
    );
  }

  private resolveInitialPosition(): DrumPlaybackPosition {
    const requested = this.options.initialPosition;
    const repeatCount = this.options.loop
      ? Number.POSITIVE_INFINITY
      : this.options.repeatCount ?? DEFAULT_REPEAT_COUNT;

    if (
      requested &&
      requested.roadmapEntryIndex >= 0 &&
      requested.roadmapEntryIndex < this.roadmap.length &&
      requested.blockPassIndex >= 0 &&
      requested.blockPassIndex < repeatCount
    ) {
      const entry = this.roadmap[requested.roadmapEntryIndex];
      if (requested.slotIndex >= entry.startSlot && requested.slotIndex < entry.endSlot) {
        return {
          slotIndex: requested.slotIndex,
          roadmapEntryIndex: requested.roadmapEntryIndex,
          blockPassIndex: requested.blockPassIndex
        };
      }
    }

    const roadmapEntryIndex = Math.max(
      0,
      this.roadmap.findIndex((entry) =>
        this.initialSlot >= entry.startSlot && this.initialSlot < entry.endSlot
      )
    );

    return { slotIndex: this.initialSlot, roadmapEntryIndex, blockPassIndex: 0 };
  }

  private scheduleCountIn(transportStartTime: number, backend: DrumPlaybackBackend): void {
    getCountInPulses(
      this.block,
      this.options.countInMode ?? "off",
      this.initialSlot
    ).forEach((pulse) => {
      backend.scheduleHits(
        [createMetronomeHit(pulse.isDownbeat)],
        transportStartTime + pulse.quarterOffset * this.secondsPerQuarter,
        pulse.intervalQuarter * this.secondsPerQuarter,
        pulse.intervalQuarter * this.secondsPerQuarter
      );
    });
  }

  private scheduleBlockPass(
    blockPassIndex: number,
    firstRoadmapEntryIndex: number,
    firstSlot: number,
    passStartTime: number
  ): void {
    if (!this.backend || this.stopped) {
      return;
    }

    const backend = this.backend;
    let occurrenceStartTime = passStartTime;

    for (let roadmapEntryIndex = firstRoadmapEntryIndex; roadmapEntryIndex < this.roadmap.length; roadmapEntryIndex++) {
      const entry = this.roadmap[roadmapEntryIndex];
      const entryStartSlot = roadmapEntryIndex === firstRoadmapEntryIndex
        ? clampInitialSlot(firstSlot, entry.startSlot, entry.endSlot)
        : entry.startSlot;
      const durationSeconds = getRangeDurationSeconds(
        this.block,
        entryStartSlot,
        entry.endSlot,
        this.options.speedPercent ?? 100
      );

      this.scheduleRoadmapEntry(
        entry,
        entryStartSlot,
        occurrenceStartTime,
        backend
      );
      this.scheduledOccurrences.push({
        ...entry,
        startSlot: entryStartSlot,
        roadmapEntryIndex,
        blockPassIndex,
        startTime: occurrenceStartTime,
        endTime: occurrenceStartTime + durationSeconds
      });
      occurrenceStartTime += durationSeconds;
    }

    this.timers.push(
      window.setTimeout(() => {
        if (this.stopped) {
          return;
        }

        const repeatCount = this.options.loop
          ? Number.POSITIVE_INFINITY
          : this.options.repeatCount ?? DEFAULT_REPEAT_COUNT;
        if (this.options.loop || blockPassIndex + 1 < repeatCount) {
          this.scheduleBlockPass(
            blockPassIndex + 1,
            0,
            this.roadmap[0].startSlot,
            occurrenceStartTime
          );
        } else {
          this.stop();
          this.onEnded();
        }
      },
      Math.max(0, (occurrenceStartTime - backend.currentTime) * 1000))
    );
  }

  private scheduleRoadmapEntry(
    entry: PlaybackRoadmapEntry,
    entryStartSlot: number,
    entryStartTime: number,
    backend: DrumPlaybackBackend
  ): void {
    const entryStartQuarter = getSlotBoundaryQuarter(this.block, entryStartSlot);
    const metronomeMode = this.options.metronomeMode ?? "off";

    this.timers.push(
      window.setTimeout(() => {
        if (!this.stopped) {
          this.onSlotChange(entryStartSlot);
          this.options.onBarChange?.(entry.barIndex);
        }
      }, Math.max(0, (entryStartTime - backend.currentTime) * 1000))
    );

    this.block.slots.slice(entryStartSlot, entry.endSlot).forEach((slot) => {
      const slotTime =
        entryStartTime +
        (slot.startQuarter - entryStartQuarter) * this.secondsPerQuarter;
      const writtenHits = metronomeMode === "metronome-only"
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
      getMetronomePulses(this.block, entryStartSlot, entry.endSlot).forEach((pulse) => {
        const pulseTime =
          entryStartTime +
          (pulse.quarterOffset - entryStartQuarter) * this.secondsPerQuarter;

        backend.scheduleHits(
          [createMetronomeHit(pulse.isDownbeat)],
          pulseTime,
          pulse.intervalQuarter * this.secondsPerQuarter,
          pulse.intervalQuarter * this.secondsPerQuarter
        );
      });
    }

  }

  getCurrentPlaybackPosition(): DrumPlaybackPosition {
    if (!this.backend || this.backend.currentTime <= this.playbackStartTime || this.secondsPerQuarter <= 0) {
      return this.resolveInitialPosition();
    }

    const currentTime = this.backend.currentTime;
    const occurrence = this.scheduledOccurrences.find((candidate) =>
      currentTime >= candidate.startTime && currentTime < candidate.endTime
    ) ?? this.scheduledOccurrences[this.scheduledOccurrences.length - 1];

    if (!occurrence) {
      return this.resolveInitialPosition();
    }

    if (currentTime >= occurrence.endTime && this.canContinueAfterPass(occurrence.blockPassIndex)) {
      return this.getPositionInFuturePass(
        currentTime - occurrence.endTime,
        occurrence.blockPassIndex + 1
      );
    }

    const elapsedQuarter = Math.max(0, currentTime - occurrence.startTime) / this.secondsPerQuarter;
    const slotIndex = getSlotIndexAtQuarter(
      this.block,
      getSlotBoundaryQuarter(this.block, occurrence.startSlot) + elapsedQuarter,
      occurrence.startSlot,
      occurrence.endSlot
    );

    return {
      slotIndex,
      roadmapEntryIndex: occurrence.roadmapEntryIndex,
      blockPassIndex: occurrence.blockPassIndex
    };
  }

  private canContinueAfterPass(blockPassIndex: number): boolean {
    return this.options.loop || blockPassIndex + 1 < (this.options.repeatCount ?? DEFAULT_REPEAT_COUNT);
  }

  private getPositionInFuturePass(
    elapsedAfterPreviousPass: number,
    firstBlockPassIndex: number
  ): DrumPlaybackPosition {
    const entryDurations = this.roadmap.map((entry) =>
      getRangeDurationSeconds(
        this.block,
        entry.startSlot,
        entry.endSlot,
        this.options.speedPercent ?? 100
      )
    );
    const passDuration = entryDurations.reduce((sum, duration) => sum + duration, 0);

    if (passDuration <= 0) {
      return {
        slotIndex: this.roadmap[0]?.startSlot ?? this.rangeStartSlot,
        roadmapEntryIndex: 0,
        blockPassIndex: firstBlockPassIndex
      };
    }

    const additionalPasses = Math.floor(elapsedAfterPreviousPass / passDuration);
    let elapsedInPass = elapsedAfterPreviousPass % passDuration;

    for (let roadmapEntryIndex = 0; roadmapEntryIndex < this.roadmap.length; roadmapEntryIndex++) {
      const entry = this.roadmap[roadmapEntryIndex];
      const duration = entryDurations[roadmapEntryIndex] ?? 0;
      if (elapsedInPass < duration || roadmapEntryIndex === this.roadmap.length - 1) {
        return {
          slotIndex: getSlotIndexAtQuarter(
            this.block,
            getSlotBoundaryQuarter(this.block, entry.startSlot) + elapsedInPass / this.secondsPerQuarter,
            entry.startSlot,
            entry.endSlot
          ),
          roadmapEntryIndex,
          blockPassIndex: firstBlockPassIndex + additionalPasses
        };
      }
      elapsedInPass -= duration;
    }

    return {
      slotIndex: this.rangeStartSlot,
      roadmapEntryIndex: 0,
      blockPassIndex: firstBlockPassIndex + additionalPasses
    };
  }

  getCurrentSlotIndex(): number {
    return this.getCurrentPlaybackPosition().slotIndex;
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
