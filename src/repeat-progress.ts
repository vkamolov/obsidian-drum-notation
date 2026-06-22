import { DrumBlock } from "./types";

export interface MeasureRepeatProgress {
  groupStartBarIndex: number;
  currentRepeat: number;
  totalRepeats: number;
}

export function getMeasureRepeatProgress(
  block: DrumBlock,
  barIndex: number
): MeasureRepeatProgress | null {
  if (!Number.isFinite(barIndex)) {
    return null;
  }

  const targetBarIndex = Math.round(barIndex);

  for (let groupStartBarIndex = 0; groupStartBarIndex < block.bars.length; groupStartBarIndex++) {
    const bar = block.bars[groupStartBarIndex];
    const declaredCount = bar.measureRepeatCount ?? 1;

    if (!bar.measureRepeat || declaredCount <= 1) {
      continue;
    }

    const availableCount = countMeasureRepeatRun(block, groupStartBarIndex);
    const totalRepeats = Math.min(declaredCount, availableCount);

    if (
      totalRepeats > 1 &&
      targetBarIndex >= groupStartBarIndex &&
      targetBarIndex < groupStartBarIndex + totalRepeats
    ) {
      return {
        groupStartBarIndex,
        currentRepeat: targetBarIndex - groupStartBarIndex + 1,
        totalRepeats
      };
    }

    groupStartBarIndex += Math.max(0, totalRepeats - 1);
  }

  return null;
}

function countMeasureRepeatRun(block: DrumBlock, startBarIndex: number): number {
  let count = 0;

  for (let barIndex = startBarIndex; barIndex < block.bars.length; barIndex++) {
    if (!block.bars[barIndex].measureRepeat) {
      break;
    }

    count++;
  }

  return count;
}
