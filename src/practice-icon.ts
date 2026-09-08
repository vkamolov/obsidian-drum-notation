/**
 * Snare drum with crossed sticks, matching the plugin logo. The geometry is drawn on the
 * same 24-unit grid as the rest of the toolbar glyphs so it lines up with them optically.
 * Shared so the Obsidian and playground toolbars cannot drift apart.
 */
export const PRACTICE_ICON_ID = "drum-notation-practice";

export interface PracticeIconShape {
  readonly tag: "ellipse" | "path";
  readonly attrs: Readonly<Record<string, string>>;
}

export const PRACTICE_ICON_SHAPES: readonly PracticeIconShape[] = [
  { tag: "path", attrs: { d: "m2 2 8 8" } },
  { tag: "path", attrs: { d: "m22 2-8 8" } },
  { tag: "ellipse", attrs: { cx: "12", cy: "9", rx: "10", ry: "5" } },
  { tag: "path", attrs: { d: "M7 13.4v7.9" } },
  { tag: "path", attrs: { d: "M12 14v8" } },
  { tag: "path", attrs: { d: "M17 13.4v7.9" } },
  { tag: "path", attrs: { d: "M2 9v8a10 5 0 0 0 20 0V9" } }
];

/**
 * Markup for Obsidian's addIcon, which renders custom icons inside a 0 0 100 100 viewBox.
 * Registering our own icon keeps the button visible regardless of the Lucide set a given
 * Obsidian build happens to bundle.
 */
export function practiceIconSvgContent(): string {
  const shapes = PRACTICE_ICON_SHAPES
    .map((shape) => {
      const attrs = Object.entries(shape.attrs).map(([key, value]) => `${key}="${value}"`).join(" ");
      return `<${shape.tag} ${attrs}/>`;
    })
    .join("");
  return `<g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${shapes}</g>`;
}
