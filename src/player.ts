import {
  getRangeDurationSecondsAtSecondsPerQuarter,
  getSecondsPerQuarter,
  getSecondsPerQuarterAtTempo,
  getSlotBoundaryQuarter,
  getSlotDurationSecondsAtSecondsPerQuarter,
  getSlotIndexAtQuarter,
  getSlotVisualDurationSecondsAtSecondsPerQuarter
} from "./music";
import {
  DrumPlaybackBackend,
  DrumPlaybackBackendFactory,
  createMetronomeHit,
  filterMutedHits,
  getCountInDurationQuarter,
  getCountInPulses,
  getEffectivePlaybackTempo,
  getMetronomePulses,
  getSafeClickSubdivisionAtTempo,
  isGapClickBar,
  normalizePlaybackSpeedPercent
} from "./playback";
import { createSynthPlaybackBackend } from "./synth";
import { normalizePracticeBarIndexes } from "./practice";
import {
  advanceTempoRampProgress,
  getTempoRampPassInStep,
  getTempoRampTempoBpm,
  shouldStopTempoRampAfterPass
} from "./tempo-ramp";
import {
  ClickSubdivision,
  DEFAULT_REPEAT_COUNT,
  DrumBlock,
  DrumPlaybackPosition,
  PlaybackOptions,
  PlaybackPassState,
  TempoRampPassState
} from "./types";

export interface PlaybackRoadmapEntry {
  barIndex: number;
  startSlot: number;
  endSlot: number;
  sectionTraversal: 0 | 1 | 2;
}

interface ScheduledOccurrence extends PlaybackRoadmapEntry {
  roadmapEntryIndex: number;
  blockPassIndex: number;
  barOccurrenceIndex: number;
  startTime: number;
  endTime: number;
  secondsPerQuarter: number;
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

export function buildSelectedPlaybackRoadmap(
  block: DrumBlock,
  selectedBarIndexes: readonly number[]
): PlaybackRoadmapEntry[] {
  return normalizePracticeBarIndexes(selectedBarIndexes, block.bars.length).map((barIndex) => {
    const bar = block.bars[barIndex];
    return {
      barIndex,
      startSlot: bar.startSlot,
      endSlot: bar.startSlot + bar.slots.length,
      sectionTraversal: 0
    };
  });
}

export class DrumPlayer {
  private backend: DrumPlaybackBackend | null = null;
  private timers: number[] = [];
  private stopped = false;
  private initialSecondsPerQuarter = 0;
  private playbackStartTime = 0;
  private rangeStartSlot = 0;
  private rangeEndSlot = 0;
  private initialSlot = 0;
  private roadmap: PlaybackRoadmapEntry[] = [];
  private scheduledOccurrences: ScheduledOccurrence[] = [];
  private selectedPlayback = false;
  private activeClickSubdivision: ClickSubdivision;

  constructor(
    private readonly audioContext: AudioContext,
    private readonly block: DrumBlock,
    private readonly onEnded: () => void,
    private readonly onSlotChange: (slotIndex: number) => void,
    private readonly options: PlaybackOptions = {},
    private readonly createPlaybackBackend: DrumPlaybackBackendFactory = createSynthPlaybackBackend
  ) {
    this.activeClickSubdivision = options.clickSubdivision ?? "beat";
  }

  async play(): Promise<void> {
    const backend = this.createPlaybackBackend(this.audioContext);

    this.backend = backend;
    await backend.start();

    if (this.stopped || this.backend !== backend) {
      return;
    }

    this.selectedPlayback = this.options.selectedBarIndexes !== undefined;
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
    if (this.selectedPlayback) {
      this.roadmap = buildSelectedPlaybackRoadmap(
        this.block,
        this.options.selectedBarIndexes ?? []
      );
      this.rangeStartSlot = this.roadmap[0]?.startSlot ?? 0;
      this.rangeEndSlot = this.roadmap[this.roadmap.length - 1]?.endSlot ?? 0;
    } else {
      const isWholeBlockRange =
        this.rangeStartSlot === 0 && this.rangeEndSlot === this.block.slots.length;
      this.roadmap = buildPlaybackRoadmap(
        this.block,
        this.rangeStartSlot,
        this.rangeEndSlot,
        isWholeBlockRange
      );
    }

    if (this.rangeEndSlot <= this.rangeStartSlot || this.roadmap.length === 0) {
      this.stop();
      this.onEnded();
      return;
    }

    const initial = this.resolveInitialPosition();
    this.initialSlot = initial.slotIndex;
    this.initialSecondsPerQuarter = this.getSecondsPerQuarterForPass(initial.blockPassIndex);
    const countInDurationSeconds =
      getCountInDurationQuarter(
        this.block,
        this.options.countInMode ?? "off",
        this.initialSlot
      ) * this.initialSecondsPerQuarter;
    const transportStartTime = backend.currentTime + 0.08;
    this.playbackStartTime = transportStartTime + countInDurationSeconds;

    this.scheduleCountIn(
      transportStartTime,
      backend,
      this.initialSlot,
      this.initialSecondsPerQuarter
    );

    this.scheduleBlockPass(
      initial.blockPassIndex,
      initial.roadmapEntryIndex,
      initial.slotIndex,
      this.playbackStartTime,
      normalizeBarOccurrenceIndex(initial.barOccurrenceIndex)
    );
  }

  private resolveInitialPosition(): DrumPlaybackPosition {
    const requested = this.options.initialPosition;
    const repeatCount = this.getRepeatCount();

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
          blockPassIndex: requested.blockPassIndex,
          barOccurrenceIndex: normalizeBarOccurrenceIndex(requested.barOccurrenceIndex)
        };
      }
    }

    const matchingEntryIndex = this.roadmap.findIndex((entry) =>
      this.initialSlot >= entry.startSlot && this.initialSlot < entry.endSlot
    );
    const roadmapEntryIndex = matchingEntryIndex >= 0 ? matchingEntryIndex : 0;
    const entry = this.roadmap[roadmapEntryIndex];

    return {
      slotIndex: matchingEntryIndex >= 0 ? this.initialSlot : entry.startSlot,
      roadmapEntryIndex,
      blockPassIndex: 0,
      barOccurrenceIndex: 0
    };
  }

  private scheduleCountIn(
    transportStartTime: number,
    backend: DrumPlaybackBackend,
    startSlot: number,
    secondsPerQuarter: number
  ): void {
    getCountInPulses(
      this.block,
      this.options.countInMode ?? "off",
      startSlot
    ).forEach((pulse) => {
      backend.scheduleHits(
        [createMetronomeHit(pulse.kind)],
        transportStartTime + pulse.quarterOffset * secondsPerQuarter,
        pulse.intervalQuarter * secondsPerQuarter,
        pulse.intervalQuarter * secondsPerQuarter
      );
    });
  }

  private scheduleBlockPass(
    blockPassIndex: number,
    firstRoadmapEntryIndex: number,
    firstSlot: number,
    passStartTime: number,
    firstBarOccurrenceIndex: number
  ): void {
    if (!this.backend || this.stopped) {
      return;
    }

    const backend = this.backend;
    const secondsPerQuarter = this.getSecondsPerQuarterForPass(blockPassIndex);
    this.options.onPassStart?.(this.getPassState(blockPassIndex, false));
    const rampPassState = this.getTempoRampPassStartState(blockPassIndex);
    if (rampPassState) {
      const safeSubdivision = getSafeClickSubdivisionAtTempo(
        this.block,
        rampPassState.tempoBpm,
        this.activeClickSubdivision
      );
      this.activeClickSubdivision = safeSubdivision;
      rampPassState.clickSubdivision = safeSubdivision;
      this.options.onTempoRampPassStart?.(rampPassState);
    }
    let occurrenceStartTime = passStartTime;
    let barOccurrenceIndex = firstBarOccurrenceIndex;

    for (let roadmapEntryIndex = firstRoadmapEntryIndex; roadmapEntryIndex < this.roadmap.length; roadmapEntryIndex++) {
      const entry = this.roadmap[roadmapEntryIndex];
      const entryStartSlot = roadmapEntryIndex === firstRoadmapEntryIndex
        ? clampInitialSlot(firstSlot, entry.startSlot, entry.endSlot)
        : entry.startSlot;
      const durationSeconds = getRangeDurationSecondsAtSecondsPerQuarter(
        this.block,
        entryStartSlot,
        entry.endSlot,
        secondsPerQuarter
      );

      this.scheduleRoadmapEntry(
        entry,
        entryStartSlot,
        occurrenceStartTime,
        backend,
        roadmapEntryIndex,
        blockPassIndex,
        barOccurrenceIndex,
        secondsPerQuarter,
        this.activeClickSubdivision
      );
      this.scheduledOccurrences.push({
        ...entry,
        startSlot: entryStartSlot,
        roadmapEntryIndex,
        blockPassIndex,
        barOccurrenceIndex,
        startTime: occurrenceStartTime,
        endTime: occurrenceStartTime + durationSeconds,
        secondsPerQuarter
      });
      occurrenceStartTime += durationSeconds;
      barOccurrenceIndex += 1;
    }

    this.timers.push(
      window.setTimeout(() => {
        if (this.stopped) {
          return;
        }

        const completedRampState = this.getTempoRampPassCompleteState(blockPassIndex);
        if (completedRampState) {
          this.options.onTempoRampPassComplete?.(completedRampState);
        }
        this.options.onPassComplete?.(this.getPassState(blockPassIndex, true));

        if (this.canContinueAfterPass(blockPassIndex)) {
          const nextPassIndex = blockPassIndex + 1;
          let nextPassStartTime = occurrenceStartTime;
          if (this.options.countInCadence === "every-pass") {
            const nextSecondsPerQuarter = this.getSecondsPerQuarterForPass(nextPassIndex);
            this.scheduleCountIn(
              nextPassStartTime,
              backend,
              this.roadmap[0].startSlot,
              nextSecondsPerQuarter
            );
            nextPassStartTime += this.getInterPassCountInDurationSeconds(nextPassIndex);
          }
          this.scheduleBlockPass(
            nextPassIndex,
            0,
            this.roadmap[0].startSlot,
            nextPassStartTime,
            barOccurrenceIndex
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
    backend: DrumPlaybackBackend,
    roadmapEntryIndex: number,
    blockPassIndex: number,
    barOccurrenceIndex: number,
    secondsPerQuarter: number,
    clickSubdivision: ClickSubdivision
  ): void {
    const entryStartQuarter = getSlotBoundaryQuarter(this.block, entryStartSlot);
    const metronomeMode = this.options.metronomeMode ?? "off";
    const gapClickMode = this.options.gapClickMode ?? "off";
    const isGapBar = isGapClickBar(gapClickMode, barOccurrenceIndex);
    const nextEntry = roadmapEntryIndex + 1 < this.roadmap.length
      ? this.roadmap[roadmapEntryIndex + 1]
      : this.canContinueAfterPass(blockPassIndex)
        ? this.roadmap[0]
        : undefined;

    this.timers.push(
      window.setTimeout(() => {
        if (!this.stopped) {
          this.onSlotChange(entryStartSlot);
          this.options.onBarChange?.(entry.barIndex, {
            barOccurrenceIndex,
            isGapBar,
            nextBarIndex: nextEntry?.barIndex ?? null,
            isNextGapBar: Boolean(nextEntry && isGapClickBar(gapClickMode, barOccurrenceIndex + 1))
          });
        }
      }, Math.max(0, (entryStartTime - backend.currentTime) * 1000))
    );

    this.block.slots.slice(entryStartSlot, entry.endSlot).forEach((slot) => {
      const slotTime =
        entryStartTime +
        (slot.startQuarter - entryStartQuarter) * secondsPerQuarter;
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
        getSlotDurationSecondsAtSecondsPerQuarter(slot, secondsPerQuarter),
        getSlotVisualDurationSecondsAtSecondsPerQuarter(
          this.block,
          slot,
          secondsPerQuarter
        )
      );
    });

    if (metronomeMode !== "off" && !isGapBar) {
      getMetronomePulses(
        this.block,
        entryStartSlot,
        entry.endSlot,
        clickSubdivision
      ).forEach((pulse) => {
        const pulseTime =
          entryStartTime +
          (pulse.quarterOffset - entryStartQuarter) * secondsPerQuarter;

        backend.scheduleHits(
          [createMetronomeHit(pulse.kind)],
          pulseTime,
          pulse.intervalQuarter * secondsPerQuarter,
          pulse.intervalQuarter * secondsPerQuarter
        );
      });
    }

  }

  getCurrentPlaybackPosition(): DrumPlaybackPosition {
    if (!this.backend || this.backend.currentTime <= this.playbackStartTime || this.initialSecondsPerQuarter <= 0) {
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
        occurrence.blockPassIndex + 1,
        occurrence.barOccurrenceIndex + 1
      );
    }

    const elapsedQuarter = Math.max(0, currentTime - occurrence.startTime) / occurrence.secondsPerQuarter;
    const slotIndex = getSlotIndexAtQuarter(
      this.block,
      getSlotBoundaryQuarter(this.block, occurrence.startSlot) + elapsedQuarter,
      occurrence.startSlot,
      occurrence.endSlot
    );

    return {
      slotIndex,
      roadmapEntryIndex: occurrence.roadmapEntryIndex,
      blockPassIndex: occurrence.blockPassIndex,
      barOccurrenceIndex: occurrence.barOccurrenceIndex
    };
  }

  private canContinueAfterPass(blockPassIndex: number): boolean {
    if (this.options.passLimit !== undefined) {
      return blockPassIndex + 1 < this.getRepeatCount();
    }
    const ramp = this.options.tempoRamp;
    if (ramp) {
      return !shouldStopTempoRampAfterPass(
        ramp.config,
        ramp.progress.completedPasses + blockPassIndex
      );
    }
    return this.options.loop || blockPassIndex + 1 < this.getRepeatCount();
  }

  private getRepeatCount(): number {
    if (this.options.passLimit !== undefined) {
      return Math.max(1, Math.round(this.options.passLimit));
    }
    if (this.options.tempoRamp || this.options.loop) {
      return Number.POSITIVE_INFINITY;
    }

    return this.selectedPlayback
      ? 1
      : this.options.repeatCount ?? DEFAULT_REPEAT_COUNT;
  }

  private getPositionInFuturePass(
    elapsedAfterPreviousPass: number,
    firstBlockPassIndex: number,
    firstBarOccurrenceIndex: number
  ): DrumPlaybackPosition {
    let elapsedInPass = Math.max(0, elapsedAfterPreviousPass);
    let blockPassIndex = firstBlockPassIndex;
    let firstOccurrenceInPass = firstBarOccurrenceIndex;

    while (true) {
      if (this.options.countInCadence === "every-pass") {
        const countInDuration = this.getInterPassCountInDurationSeconds(blockPassIndex);
        if (elapsedInPass < countInDuration) {
          return {
            slotIndex: this.roadmap[0]?.startSlot ?? this.rangeStartSlot,
            roadmapEntryIndex: 0,
            blockPassIndex,
            barOccurrenceIndex: firstOccurrenceInPass
          };
        }
        elapsedInPass -= countInDuration;
      }
      const secondsPerQuarter = this.getSecondsPerQuarterForPass(blockPassIndex);
      const entryDurations = this.roadmap.map((entry) =>
        getRangeDurationSecondsAtSecondsPerQuarter(
          this.block,
          entry.startSlot,
          entry.endSlot,
          secondsPerQuarter
        )
      );
      const passDuration = entryDurations.reduce((sum, duration) => sum + duration, 0);

      if (passDuration <= 0) {
        return {
          slotIndex: this.roadmap[0]?.startSlot ?? this.rangeStartSlot,
          roadmapEntryIndex: 0,
          blockPassIndex,
          barOccurrenceIndex: firstOccurrenceInPass
        };
      }

      if (elapsedInPass < passDuration || !this.canContinueAfterPass(blockPassIndex)) {
        for (let roadmapEntryIndex = 0; roadmapEntryIndex < this.roadmap.length; roadmapEntryIndex++) {
          const entry = this.roadmap[roadmapEntryIndex];
          const duration = entryDurations[roadmapEntryIndex] ?? 0;
          if (elapsedInPass < duration || roadmapEntryIndex === this.roadmap.length - 1) {
            return {
              slotIndex: getSlotIndexAtQuarter(
                this.block,
                getSlotBoundaryQuarter(this.block, entry.startSlot) + Math.min(elapsedInPass, duration) / secondsPerQuarter,
                entry.startSlot,
                entry.endSlot
              ),
              roadmapEntryIndex,
              blockPassIndex,
              barOccurrenceIndex: firstOccurrenceInPass + roadmapEntryIndex
            };
          }
          elapsedInPass -= duration;
        }
      }

      elapsedInPass -= passDuration;
      blockPassIndex += 1;
      firstOccurrenceInPass += this.roadmap.length;
    }
  }

  private getSecondsPerQuarterForPass(blockPassIndex: number): number {
    const ramp = this.options.tempoRamp;
    if (ramp) {
      return getSecondsPerQuarterAtTempo(
        getTempoRampTempoBpm(ramp.config, ramp.progress.completedPasses + blockPassIndex)
      );
    }

    if (this.options.exactTempoBpm !== undefined) {
      return getSecondsPerQuarterAtTempo(this.options.exactTempoBpm);
    }

    return getSecondsPerQuarter(
      this.block,
      normalizePlaybackSpeedPercent(this.options.speedPercent ?? 100)
    );
  }

  private getPassState(blockPassIndex: number, completed: boolean): PlaybackPassState {
    return {
      passIndex: blockPassIndex,
      completedPasses: blockPassIndex + (completed ? 1 : 0),
      tempoBpm: this.getTempoBpmForPass(blockPassIndex)
    };
  }

  private getTempoBpmForPass(blockPassIndex: number): number {
    const ramp = this.options.tempoRamp;
    if (ramp) {
      return getTempoRampTempoBpm(
        ramp.config,
        ramp.progress.completedPasses + blockPassIndex
      );
    }
    if (this.options.exactTempoBpm !== undefined) {
      return Math.max(1, this.options.exactTempoBpm);
    }
    return getEffectivePlaybackTempo(
      this.block.tempo,
      normalizePlaybackSpeedPercent(this.options.speedPercent ?? 100)
    );
  }

  private getInterPassCountInDurationSeconds(blockPassIndex: number): number {
    if (this.options.countInCadence !== "every-pass") return 0;
    return getCountInDurationQuarter(
      this.block,
      this.options.countInMode ?? "off",
      this.roadmap[0]?.startSlot ?? this.rangeStartSlot
    ) * this.getSecondsPerQuarterForPass(blockPassIndex);
  }

  private getTempoRampPassStartState(blockPassIndex: number): TempoRampPassState | null {
    const ramp = this.options.tempoRamp;
    if (!ramp) return null;

    const completedPasses = ramp.progress.completedPasses + blockPassIndex;
    const tempoBpm = getTempoRampTempoBpm(ramp.config, completedPasses);
    return {
      completedPasses,
      completed: false,
      tempoBpm,
      nextTempoBpm: getTempoRampTempoBpm(ramp.config, completedPasses + 1),
      passInStep: getTempoRampPassInStep(ramp.config, completedPasses),
      passesPerStep: ramp.config.passesPerStep,
      atCeiling: tempoBpm >= ramp.config.ceilingBpm,
      clickSubdivision: this.activeClickSubdivision
    };
  }

  private getTempoRampPassCompleteState(blockPassIndex: number): TempoRampPassState | null {
    const ramp = this.options.tempoRamp;
    if (!ramp) return null;

    const completedBeforePass = ramp.progress.completedPasses + blockPassIndex;
    const progress = advanceTempoRampProgress(ramp.config, completedBeforePass);
    const nextTempoBpm = getTempoRampTempoBpm(ramp.config, progress.completedPasses);
    return {
      ...progress,
      tempoBpm: nextTempoBpm,
      nextTempoBpm,
      passInStep: getTempoRampPassInStep(ramp.config, progress.completedPasses),
      passesPerStep: ramp.config.passesPerStep,
      atCeiling: nextTempoBpm >= ramp.config.ceilingBpm,
      clickSubdivision: this.activeClickSubdivision
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

function normalizeBarOccurrenceIndex(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value ?? 0)) : 0;
}
