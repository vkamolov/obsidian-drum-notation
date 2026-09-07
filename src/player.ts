import { createAudioProgressIdentity, type AudioProgressSnapshot, type PlaybackInterruptionReason } from "./audio-progress";
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

interface TimelineNotification {
  time: number;
  order: number;
  notify: () => void;
  visual: boolean;
}
interface Continuation {
  passIndex: number;
  startTime: number;
  barOccurrenceIndex: number;
  earliestTime: number;
}

const PASS_PREPARATION_LEAD_SECONDS = 0.5;
const MAX_GRACE_LEAD_SECONDS = 0.055;

export class DrumPlayer {
  private backend: DrumPlaybackBackend | null = null;
  private timer: number | null = null;
  private notifications: TimelineNotification[] = [];
  private notificationOrder = 0;
  private continuation: Continuation | null = null;
  private activeIntervals: Array<{start: number; end: number}> = [];
  private retiredActiveSeconds = 0;
  private readonly progress: AudioProgressSnapshot;
  private readonly timerWindow: Pick<Window, "setTimeout" | "clearTimeout">;
  private reconciling = false;
  private stoppedPosition: DrumPlaybackPosition | null = null;
  private readonly stateChanged = () => this.reconcile();
  private readonly visibilityChanged = () => this.reconcile();
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
    this.progress = createAudioProgressIdentity(audioContext);
    this.timerWindow = options.ownerDocument?.defaultView ?? window;
    // A player's prepared passes must not observe later mutations of host-owned controls.
    this.options = {
      ...options,
      mutedInstrumentIds: options.mutedInstrumentIds ? new Set(options.mutedInstrumentIds) : undefined,
      selectedBarIndexes: options.selectedBarIndexes ? [...options.selectedBarIndexes] : undefined,
      tempoRamp: options.tempoRamp ? {
        config: {...options.tempoRamp.config, target: options.tempoRamp.config.target.kind === "selected-bars"
          ? {...options.tempoRamp.config.target, barIndexes: [...options.tempoRamp.config.target.barIndexes]}
          : {...options.tempoRamp.config.target}},
        progress: {...options.tempoRamp.progress}
      } : undefined
    };
  }

  async play(): Promise<void> {
    const backend = this.createPlaybackBackend(this.audioContext);

    this.backend = backend;
    try {
      await backend.start();
    } catch {
      if (!this.stopped && this.backend === backend) this.interrupt("start-failed");
      return;
    }

    if (this.stopped || this.backend !== backend) {
      return;
    }

    this.audioContext.addEventListener("statechange", this.stateChanged);
    this.options.ownerDocument?.addEventListener("visibilitychange", this.visibilityChanged);
    if (this.audioContext.state !== "running") {
      this.interrupt(this.contextInterruptionReason());
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
    if (countInDurationSeconds > 0) this.activeIntervals.push({start: transportStartTime, end: this.playbackStartTime});

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
    this.publishAudioProgress();
    this.reconcile();
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
      slotIndex: matchingEntryIndex >= 0 ? this.initialSlot : entry?.startSlot ?? this.initialSlot,
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
    const rampPassState = this.getTempoRampPassStartState(blockPassIndex);
    if (rampPassState) {
      const safeSubdivision = getSafeClickSubdivisionAtTempo(
        this.block,
        rampPassState.tempoBpm,
        this.activeClickSubdivision
      );
      this.activeClickSubdivision = safeSubdivision;
      rampPassState.clickSubdivision = safeSubdivision;

    }
    const passClickSubdivision = this.activeClickSubdivision;
    this.enqueue(passStartTime, () => {
      this.options.onPassStart?.(this.getPassState(blockPassIndex, false));
      if (rampPassState) this.options.onTempoRampPassStart?.(rampPassState);
    });
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

    this.activeIntervals.push({start: passStartTime, end: occurrenceStartTime});
    const completedRampState = this.getTempoRampPassCompleteState(blockPassIndex);
    if (completedRampState) completedRampState.clickSubdivision = passClickSubdivision;
    this.enqueue(occurrenceStartTime, () => {
      if (completedRampState) this.options.onTempoRampPassComplete?.(completedRampState);
      this.options.onPassComplete?.(this.getPassState(blockPassIndex, true));
      if (!this.stopped && !this.canContinueAfterPass(blockPassIndex)) {
        this.stop();
        this.onEnded();
      }
    });
    this.continuation = this.canContinueAfterPass(blockPassIndex) ? {
      passIndex: blockPassIndex + 1,
      startTime: occurrenceStartTime,
      barOccurrenceIndex,
      earliestTime: this.getInterPassCountInDurationSeconds(blockPassIndex + 1) > 0
        ? occurrenceStartTime
        : occurrenceStartTime - this.getGraceLeadSeconds()
    } : null;
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

    this.enqueue(entryStartTime, () => {
      if (this.options.ownerDocument?.visibilityState !== "hidden") this.onSlotChange(entryStartSlot);
      this.options.onBarChange?.(entry.barIndex, {
        barOccurrenceIndex,
        isGapBar,
        nextBarIndex: nextEntry?.barIndex ?? null,
        isNextGapBar: Boolean(nextEntry && isGapClickBar(gapClickMode, barOccurrenceIndex + 1))
      });
    });

    this.block.slots.slice(entryStartSlot, entry.endSlot).forEach((slot) => {
      const slotTime =
        entryStartTime +
        (slot.startQuarter - entryStartQuarter) * secondsPerQuarter;
      const writtenHits = metronomeMode === "metronome-only"
        ? []
        : filterMutedHits(slot.hits, this.options.mutedInstrumentIds);

      if (slot.hits.length > 0) {
        this.enqueue(slotTime, () => this.onSlotChange(slot.index), true);
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
    if (this.stoppedPosition) return {...this.stoppedPosition};
    if (!this.backend || this.backend.currentTime <= this.playbackStartTime || this.initialSecondsPerQuarter <= 0) {
      return this.resolveInitialPosition();
    }

    const currentTime = this.backend.currentTime;
    const occurrence = this.scheduledOccurrences.find((candidate) =>
      currentTime >= candidate.startTime && currentTime < candidate.endTime
    ) ?? this.scheduledOccurrences.find(candidate => currentTime < candidate.startTime)
      ?? this.scheduledOccurrences[this.scheduledOccurrences.length - 1];

    if (!occurrence) {
      return this.resolveInitialPosition();
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

  getAudioProgress(): AudioProgressSnapshot {
    if (this.backend && !this.stopped) {
      const now = this.backend.currentTime;
      this.progress.activeAudioMs = 1000 * (this.retiredActiveSeconds + this.activeIntervals.reduce(
        (total, interval) => total + Math.max(0, Math.min(now, interval.end) - interval.start), 0
      ));
    }
    return {...this.progress};
  }

  private publishAudioProgress(): void {
    const progress = this.getAudioProgress();
    this.options.onAudioProgress?.(progress);
  }

  private enqueue(time: number, notify: () => void, visual = false): void {
    this.notifications.push({time, notify, visual, order: this.notificationOrder++});
  }

  private getGraceLeadSeconds(): number {
    if (this.options.metronomeMode === "metronome-only") return 0;
    // Only the first performed slot can precede a pass's nominal boundary.
    const hits = this.block.slots[this.roadmap[0]?.startSlot ?? 0]?.hits ?? [];
    if (hits.some(hit => !this.options.mutedInstrumentIds?.has(hit.instrument.id) && hit.articulation === "drag")) return MAX_GRACE_LEAD_SECONDS;
    return hits.some(hit => !this.options.mutedInstrumentIds?.has(hit.instrument.id) && hit.articulation === "flam") ? 0.035 : 0;
  }

  private contextInterruptionReason(): PlaybackInterruptionReason {
    const state: string = this.audioContext.state;
    return state === "closed" ? "closed" : state === "suspended" ? "suspended" : "interrupted";
  }

  /** The only event-delivery path, shared by timer wakes and lifecycle transitions. */
  reconcile(continuePlayback = true): void {
    if (this.stopped || !this.backend || this.reconciling) return;
    this.reconciling = true;
    try {
      if (this.timer !== null) this.timerWindow.clearTimeout(this.timer);
      this.timer = null;
      const now = this.backend.currentTime;
      this.publishAudioProgress();
      this.notifications.sort((left, right) => left.time - right.time || left.order - right.order);
      while (!this.stopped && this.notifications[0]?.time <= now) {
        const notification = this.notifications.shift();
        if (notification && (!notification.visual || this.options.ownerDocument?.visibilityState !== "hidden")) notification.notify();
      }
      if (this.stopped || !continuePlayback) return;
      if (this.audioContext.state !== "running") {
        this.interrupt(this.contextInterruptionReason());
        return;
      }
      while (this.continuation && this.continuation.earliestTime - now <= PASS_PREPARATION_LEAD_SECONDS) {
        const next = this.continuation;
        if (next.earliestTime < this.backend.currentTime) {
          this.interrupt("missed-deadline");
          return;
        }
        const countIn = this.getInterPassCountInDurationSeconds(next.passIndex);
        if (countIn > 0) {
          this.scheduleCountIn(next.startTime, this.backend, this.roadmap[0].startSlot, this.getSecondsPerQuarterForPass(next.passIndex));
          this.activeIntervals.push({start: next.startTime, end: next.startTime + countIn});
        }
        this.scheduleBlockPass(next.passIndex, 0, this.roadmap[0].startSlot, next.startTime + countIn, next.barOccurrenceIndex);
      }
      this.notifications.sort((left, right) => left.time - right.time || left.order - right.order);
      while (this.activeIntervals[0]?.end <= now) {
        const interval = this.activeIntervals.shift();
        if (interval) this.retiredActiveSeconds += interval.end - interval.start;
      }
      // Retain one preceding occurrence to resolve a paused boundary or count-in gap.
      while (this.scheduledOccurrences.length > 1 && this.scheduledOccurrences[1].endTime <= now) this.scheduledOccurrences.shift();
      const nextTime = Math.min(this.notifications[0]?.time ?? Infinity,
        this.continuation ? this.continuation.earliestTime - PASS_PREPARATION_LEAD_SECONDS : Infinity);
      if (Number.isFinite(nextTime)) {
        this.timer = this.timerWindow.setTimeout(() => {
          this.timer = null;
          this.reconcile();
        }, Math.max(10, Math.ceil((nextTime - this.backend.currentTime) * 1000)));
      }
    } finally {
      this.reconciling = false;
    }
  }

  private interrupt(reason: PlaybackInterruptionReason): void {
    const position = this.getCurrentPlaybackPosition();
    this.stop();
    this.options.onInterrupted?.(reason, position);
  }

  stop(): void {
    if (this.stopped) return;
    this.reconcile(false);
    if (this.stopped) return;
    this.stoppedPosition = this.getCurrentPlaybackPosition();
    this.publishAudioProgress();
    this.stopped = true;
    if (this.timer !== null) this.timerWindow.clearTimeout(this.timer);
    this.timer = null;
    this.notifications = [];
    this.continuation = null;
    this.activeIntervals = [];
    this.scheduledOccurrences = [];
    this.audioContext.removeEventListener("statechange", this.stateChanged);
    this.options.ownerDocument?.removeEventListener("visibilitychange", this.visibilityChanged);
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
