import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// The playground inlines its own Lucide glyphs instead of pulling the icon set in, so a call
// asking for an id the table does not carry silently renders an empty svg: a blank slot where
// the icon should be. That has bitten the Practice button and the selection actions already,
// so pin the invariant rather than the individual ids.
const ICONS_SOURCE = readFileSync("web/src/icons.ts", "utf8");
const APP_SOURCE = readFileSync("web/src/app.ts", "utf8");

function availableIconIds(): Set<string> {
  const table = ICONS_SOURCE.slice(
    ICONS_SOURCE.indexOf("const ICON_SHAPES"),
    ICONS_SOURCE.indexOf("export function createIconSvg")
  );
  const ids = new Set<string>();
  for (const match of table.matchAll(/^ {2}(?:"([^"]+)"|([A-Za-z0-9_-]+))\s*:/gm)) {
    const [, quoted, bare] = match;
    if (quoted ?? bare) ids.add(quoted ?? bare);
  }
  return ids;
}

/** Ids reached through a variable are not visible to a source scan; literal call sites are. */
function requestedIconIds(): Map<string, number> {
  const requested = new Map<string, number>();
  const calls = [
    ...APP_SOURCE.matchAll(/createIconSvg\(([^)]*)\)/g),
    ...APP_SOURCE.matchAll(/decorateButton\([^,]+,\s*([^)]*)\)/g)
  ];
  for (const call of calls) {
    for (const literal of call[1].matchAll(/"([^"]+)"/g)) {
      const line = APP_SOURCE.slice(0, call.index ?? 0).split("\n").length;
      if (!requested.has(literal[1])) requested.set(literal[1], line);
    }
  }
  return requested;
}

describe("playground icon table", () => {
  it("carries every glyph the playground asks for by name", () => {
    const available = availableIconIds();
    const missing = [...requestedIconIds()]
      .filter(([id]) => !available.has(id))
      .map(([id, line]) => `${id} (web/src/app.ts:${line})`);
    expect(missing).toEqual([]);
  });

  it("finds the call sites and the table, so an empty scan cannot pass silently", () => {
    expect(availableIconIds().size).toBeGreaterThan(5);
    expect(requestedIconIds().size).toBeGreaterThan(5);
    expect(availableIconIds()).toContain("maximize-2");
  });
});
