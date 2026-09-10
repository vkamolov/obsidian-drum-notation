# Completed toolbar acceptance experiment — retired

The A/B/C experiment accepted the Practice-removal and tempo-label tradeoff in
commit `ade2907`. `initial-measurements.json` and `historical-provenance.json`
preserve the original evidence unchanged. Statements within these historical
records about repeated A/B/C runs describe the retired procedure, not current CI.

Recover original bytes when investigating that decision:

```sh
git show ade2907:tests/fixtures/toolbar/native-original.json
git show ade2907:tests/fixtures/toolbar/original.css
```

No ongoing gate compares against A/B or `C <= max(A, B) + 1`. Current layout tests
protect containment and fixture validity independently of historical thresholds.
The historical capture facts, platform/font limitations, and capture timing have
not been retroactively rewritten. See `docs/focus-view-implementation.md` for
measured tradeoffs and outstanding native/publication verification.
