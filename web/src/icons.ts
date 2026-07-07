// Inline Lucide icon glyphs, matching the ids the Obsidian plugin feeds to
// setIcon (play / square / repeat-1 / repeat / timer / pencil). Hand-inlined so the web
// app stays dependency-free while looking the same as the plugin toolbar.

const SVG_NS = "http://www.w3.org/2000/svg";
const activeDocument: Document = globalThis["document"];

type IconShape = {
  tag: "circle" | "line" | "path" | "polygon" | "rect";
  attrs: Record<string, string>;
};

const REPEAT_SHAPES: IconShape[] = [
  { tag: "path", attrs: { d: "m17 2 4 4-4 4" } },
  { tag: "path", attrs: { d: "M3 11v-1a4 4 0 0 1 4-4h14" } },
  { tag: "path", attrs: { d: "m7 22-4-4 4-4" } },
  { tag: "path", attrs: { d: "M21 13v1a4 4 0 0 1-4 4H3" } }
];

const ICON_SHAPES: Record<string, IconShape[]> = {
  play: [{ tag: "polygon", attrs: { points: "6 3 20 12 6 21 6 3" } }],
  square: [{ tag: "rect", attrs: { width: "18", height: "18", x: "3", y: "3", rx: "2" } }],
  repeat: REPEAT_SHAPES,
  "repeat-1": [...REPEAT_SHAPES, { tag: "path", attrs: { d: "M11 10h1v4" } }],
  timer: [
    { tag: "line", attrs: { x1: "10", x2: "14", y1: "2", y2: "2" } },
    { tag: "line", attrs: { x1: "12", x2: "15", y1: "14", y2: "11" } },
    { tag: "circle", attrs: { cx: "12", cy: "14", r: "8" } }
  ],
  pencil: [
    { tag: "path", attrs: { d: "M12 20h9" } },
    { tag: "path", attrs: { d: "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" } }
  ],
  "volume-2": [
    { tag: "polygon", attrs: { points: "11 5 6 9 2 9 2 15 6 15 11 19 11 5" } },
    { tag: "path", attrs: { d: "M15.54 8.46a5 5 0 0 1 0 7.07" } },
    { tag: "path", attrs: { d: "M19.07 4.93a10 10 0 0 1 0 14.14" } }
  ],
  "volume-x": [
    { tag: "polygon", attrs: { points: "11 5 6 9 2 9 2 15 6 15 11 19 11 5" } },
    { tag: "line", attrs: { x1: "23", x2: "17", y1: "9", y2: "15" } },
    { tag: "line", attrs: { x1: "17", x2: "23", y1: "9", y2: "15" } }
  ]
};

export function createIconSvg(name: string): SVGSVGElement {
  const svg = activeDocument.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "pg-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  for (const shape of ICON_SHAPES[name] ?? []) {
    const child = activeDocument.createElementNS(SVG_NS, shape.tag);
    Object.entries(shape.attrs).forEach(([key, value]) => child.setAttribute(key, value));
    svg.appendChild(child);
  }

  return svg;
}
