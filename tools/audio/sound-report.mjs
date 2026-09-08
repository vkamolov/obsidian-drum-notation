export const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
export const populationSD = values => { const average = mean(values); return Math.sqrt(mean(values.map(value => (value - average) ** 2))); };

/** Frozen seeded acceptance rules, deliberately unchanged from the capture comparator. */
export function compareMeasurements(old, draws) {
  const failures = [], key = old.key, originals = old.draws.slice(8);
  for (const [field, limit] of [['energy', 1], ['attack', 1], ['end', 1]]) if (Math.abs(mean(draws.map(draw => draw[field])) - mean(originals.map(draw => draw[field]))) > limit) failures.push(`${key}: ${field}`);
  if (draws.some(draw => draw.nonFinite > 0)) failures.push(`${key}: nonfinite samples`);
  if (draws.some(draw => draw.clipping > 0) && !originals.some(draw => draw.clipping > 0)) failures.push(`${key}: new clipping`);
  if (20 * Math.log10(mean(draws.map(draw => draw.peak)) / mean(originals.map(draw => draw.peak))) > 1) failures.push(`${key}: peak increase`);
  for (const [index, window] of old.tolerances.entries()) {
    if (!window.audible) continue;
    if (window.tolerance > 4) { failures.push(`${key}: unstable original window ${index}`); continue; }
    if (Math.abs(mean(draws.map(draw => draw.rms[index])) - window.mean) > window.tolerance) failures.push(`${key}: RMS window ${index}`);
  }
  const spectral = list => mean(list.flatMap(draw => draw.centroids.filter(value => value > 0)));
  if (Math.abs(spectral(draws) / spectral(originals) - 1) > 0.1) failures.push(`${key}: spectral centroid`);
  return failures;
}

export function variabilityReport(baseline, records) {
  const coverage = {all: {total: 0, floored: 0, recoverable: 0}, audible: {total: 0, floored: 0, recoverable: 0}};
  const caseMeans = [];
  const rows = [], byKey = new Map(records.map(record => [record.key, record]));
  for (const item of baseline.cases) {
    const draws = byKey.get(item.key)?.draws.slice(baseline.seeds.length);
    if (!draws || draws.length !== 32) throw new Error(`Expected 32 unseeded draws: ${item.key}`);
    if (item.draws) {
      const originalDraws = item.draws.slice(baseline.seeds.length);
      caseMeans.push({case: item.key, fields: Object.fromEntries(['energy', 'peak', 'attack', 'end'].map(field => [field, {
        originalMean: mean(originalDraws.map(draw => draw[field])), observedMean: mean(draws.map(draw => draw[field])),
        originalObservedSD: populationSD(originalDraws.map(draw => draw[field])), observedSD: populationSD(draws.map(draw => draw[field]))
      }]))});
    }
    for (const [index, window] of item.tolerances.entries()) {
      if (!(window.tolerance >= 2)) throw new Error(`Invalid frozen band: ${item.key}/${index}`);
      const recoverable = window.tolerance > 2;
      for (const group of window.audible ? [coverage.all, coverage.audible] : [coverage.all]) {
        group.total++; group[recoverable ? 'recoverable' : 'floored']++;
      }
      const levels = draws.map(draw => draw.rms[index]);
      if (!levels.every(Number.isFinite)) throw new Error(`Missing/nonfinite RMS: ${item.key}/${index}`);
      const sd = populationSD(levels), band = Math.max(2, sd * 3);
      const originalSD = recoverable ? window.tolerance / 3 : null;
      rows.push({case: item.key, index, audible: window.audible, comparison: recoverable ? 'observed-SD' : 'bound',
        originalObservedSD: originalSD, originalSDBound: recoverable ? null : 2 / 3,
        observedMean: mean(levels), originalMean: window.mean, observedSD: sd, observedBand: band,
        sdRatio: originalSD ? sd / originalSD : null, boundSatisfied: recoverable ? null : sd <= 2 / 3,
        bandExpanded: band > window.tolerance, historicalInstability: window.tolerance > 4,
        observedInstability: band > 4, newlyObservedInstability: band > 4 && window.tolerance <= 4,
        approximateRelativeSDUncertainty: sd > 0 ? 1 / Math.sqrt(2 * 31) : null,
        approximateRelativeRatioUncertainty: originalSD && sd > 0 ? Math.sqrt(2) / Math.sqrt(2 * 31) : null});
    }
  }
  for (const group of Object.values(coverage)) group.flooredPercent = 100 * group.floored / group.total;
  return {coverage, attribution: 'Original OS, architecture and executable identity are unknown. Differences confound engine build, platform and sampling.',
    uncertainty: 'Normal-theory approximations: 12.7% for one 32-draw SD, approximately 18% for a ratio of independent estimates; not confidence intervals or significance thresholds. Windows are correlated. Zero spread has no meaningful relative uncertainty.',
    caseMeans, rows, recoverableWindows: rows.filter(row => row.comparison === 'observed-SD')};
}

export function formatVariability(report) {
  const lines = ['# Sound reconstruction variability', '', '| Coverage | Total | Floored | Recoverable SD |', '|---|---:|---:|---:|'];
  for (const [name, group] of Object.entries(report.coverage)) lines.push(`| ${name} | ${group.total} | ${group.floored} (${group.flooredPercent.toFixed(1)}%) | ${group.recoverable} |`);
  lines.push('', report.attribution, '', report.uncertainty, '', 'Floored windows are bound checks only (original observed SD ≤ 2/3 dB). Historical instability remains unresolved. Full bound checks and means are in report.json.', '', '| Case/window | Audible | Original SD | New SD | Ratio | Approx. SD/ratio uncertainty | Historical/new instability |', '|---|---|---:|---:|---:|---|---|');
  for (const row of report.recoverableWindows) lines.push(`| ${row.case}/${row.index} | ${row.audible} | ${row.originalObservedSD.toFixed(5)} | ${row.observedSD.toFixed(5)} | ${row.sdRatio.toFixed(4)} | ${row.observedSD > 0 ? '12.7% / 18% (approx.)' : 'undefined (zero spread)'} | ${row.historicalInstability}/${row.observedInstability} |`);
  return lines.join('\n') + '\n';
}
