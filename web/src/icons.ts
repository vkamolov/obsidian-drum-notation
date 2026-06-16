// Inline Lucide icon glyphs, matching the ids the Obsidian plugin feeds to
// setIcon (play / square / repeat-1 / repeat / pencil). Hand-inlined so the web
// app stays dependency-free while looking the same as the plugin toolbar.

const SVG_ATTRS =
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

const REPEAT_PATHS =
  '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>';

const ICON_PATHS: Record<string, string> = {
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  square: '<rect width="18" height="18" x="3" y="3" rx="2"/>',
  repeat: REPEAT_PATHS,
  "repeat-1": `${REPEAT_PATHS}<path d="M11 10h1v4"/>`,
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'
};

export function iconSvg(name: string): string {
  return `<svg class="pg-icon" ${SVG_ATTRS} aria-hidden="true" focusable="false">${ICON_PATHS[name] ?? ""}</svg>`;
}
