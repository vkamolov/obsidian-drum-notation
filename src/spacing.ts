export function allocateBarWidths(
  slotCounts: readonly number[],
  totalWidth: number,
  firstBarHeaderWidth: number,
  minimumRhythmicWidth: number
): number[] {
  if (slotCounts.length === 0) {
    return [];
  }

  const width = Math.max(0, totalWidth);
  const headerWidth = Math.min(width, Math.max(0, firstBarHeaderWidth));
  const rhythmicWidth = Math.max(0, width - headerWidth);
  const weights = slotCounts.map((count) => Math.max(0, count));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const normalizedWeights = totalWeight > 0 ? weights : weights.map(() => 1);
  const minimum = Math.max(0, minimumRhythmicWidth);
  const minimumTotal = minimum * slotCounts.length;
  const rhythmicWidths =
    rhythmicWidth >= minimumTotal
      ? allocateWithMinimums(normalizedWeights, rhythmicWidth, minimum)
      : allocateProportionally(normalizedWeights, rhythmicWidth);

  rhythmicWidths[0] += headerWidth;
  rhythmicWidths[rhythmicWidths.length - 1] += width - rhythmicWidths.reduce((sum, barWidth) => sum + barWidth, 0);

  return rhythmicWidths;
}

function allocateWithMinimums(weights: readonly number[], totalWidth: number, minimum: number): number[] {
  const widths = Array<number>(weights.length).fill(0);
  const remainingIndexes = new Set(weights.map((_, index) => index));
  let remainingWidth = totalWidth;

  while (remainingIndexes.size > 0) {
    const remainingWeight = Array.from(remainingIndexes).reduce((sum, index) => sum + weights[index], 0);
    const undersized = Array.from(remainingIndexes).filter((index) => {
      const proportionalWidth =
        remainingWeight > 0
          ? (remainingWidth * weights[index]) / remainingWeight
          : remainingWidth / remainingIndexes.size;

      return proportionalWidth < minimum;
    });

    if (undersized.length === 0) {
      for (const index of remainingIndexes) {
        widths[index] =
          remainingWeight > 0
            ? (remainingWidth * weights[index]) / remainingWeight
            : remainingWidth / remainingIndexes.size;
      }
      break;
    }

    for (const index of undersized) {
      widths[index] = minimum;
      remainingWidth -= minimum;
      remainingIndexes.delete(index);
    }
  }

  return widths;
}

function allocateProportionally(weights: readonly number[], totalWidth: number): number[] {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  if (totalWeight <= 0) {
    return weights.map(() => totalWidth / weights.length);
  }

  return weights.map((weight) => (totalWidth * weight) / totalWeight);
}
