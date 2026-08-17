import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PLUGIN_ROOT } from "./plugin-paths.mjs";

const fixtureRoot = path.join(PLUGIN_ROOT, "submission", "fixtures");
await mkdir(fixtureRoot, { recursive: true });

function staff(top, x1 = 90, x2 = 1510, spacing = 18) {
  return Array.from({ length: 5 }, (_, index) =>
    `<line x1="${x1}" y1="${top + index * spacing}" x2="${x2}" y2="${top + index * spacing}" class="staff"/>`
  ).join("");
}

function clef(top, x = 108) {
  return `<rect x="${x}" y="${top + 15}" width="7" height="44"/><rect x="${x + 12}" y="${top + 15}" width="7" height="44"/>`;
}

function meter(top, topNumber = 4, bottomNumber = 4, x = 142) {
  return `<text x="${x}" y="${top + 34}" class="meter">${topNumber}</text><text x="${x}" y="${top + 68}" class="meter">${bottomNumber}</text>`;
}

function barline(x, top, height = 72) {
  return `<line x1="${x}" y1="${top}" x2="${x}" y2="${top + height}" class="bar"/>`;
}

function repeatBarline(x, top, side) {
  const thick = side === "start" ? x : x - 7;
  const thin = side === "start" ? x + 10 : x - 17;
  const dots = side === "start" ? x + 24 : x - 30;
  return `<line x1="${thick}" y1="${top}" x2="${thick}" y2="${top + 72}" class="repeat-thick"/><line x1="${thin}" y1="${top}" x2="${thin}" y2="${top + 72}" class="bar"/><circle cx="${dots}" cy="${top + 27}" r="4"/><circle cx="${dots}" cy="${top + 45}" r="4"/>`;
}

function xNote(x, y, stemTop, options = {}) {
  const ledger = options.ledger ? `<line x1="${x - 15}" y1="${y}" x2="${x + 15}" y2="${y}" class="note"/>` : "";
  const accent = options.accent ? `<path d="M ${x - 9} ${stemTop - 17} L ${x + 9} ${stemTop - 11} L ${x - 9} ${stemTop - 5}" class="note fill-none"/>` : "";
  return `${ledger}<path d="M ${x - 7} ${y - 7} L ${x + 7} ${y + 7} M ${x + 7} ${y - 7} L ${x - 7} ${y + 7}" class="note fill-none"/><line x1="${x + 7}" y1="${y}" x2="${x + 7}" y2="${stemTop}" class="note"/>${accent}`;
}

function drumNote(x, y, stemBottom, options = {}) {
  const ghost = options.ghost ? `<ellipse cx="${x}" cy="${y}" rx="10" ry="7" class="note fill-none"/>` : "";
  const accent = options.accent ? `<path d="M ${x - 10} ${y - 25} L ${x + 10} ${y - 18} L ${x - 10} ${y - 11}" class="note fill-none"/>` : "";
  const slash = options.slash ? `<line x1="${x + 2}" y1="${y - 11}" x2="${x + 14}" y2="${y - 22}" class="ornament"/>` : "";
  return `${ghost}<ellipse cx="${x}" cy="${y}" rx="9" ry="6" transform="rotate(-13 ${x} ${y})"/><line x1="${x - 8}" y1="${y}" x2="${x - 8}" y2="${stemBottom}" class="note"/>${accent}${slash}`;
}

function graceNote(x, y, targetX, targetY) {
  return `<ellipse cx="${x}" cy="${y}" rx="5" ry="3.5" transform="rotate(-13 ${x} ${y})"/><line x1="${x + 4}" y1="${y}" x2="${x + 4}" y2="${y - 23}" class="ornament"/><line x1="${x - 3}" y1="${y - 10}" x2="${x + 10}" y2="${y - 18}" class="ornament"/><path d="M ${x + 5} ${y - 20} Q ${x + 20} ${y - 13}, ${targetX - 8} ${targetY - 7}" class="ornament fill-none"/>`;
}

function quarterRest(x, y) {
  return `<path d="M ${x - 6} ${y - 20} L ${x + 5} ${y - 8} L ${x - 3} ${y + 3} L ${x + 7} ${y + 14} L ${x - 5} ${y + 25} M ${x - 6} ${y + 25} Q ${x + 7} ${y + 19}, ${x + 4} ${y + 31}" class="rest fill-none"/>`;
}

function beam(x1, x2, y, secondary = false) {
  return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" class="beam"/>${secondary ? `<line x1="${x1}" y1="${y + 8}" x2="${x2}" y2="${y + 8}" class="beam secondary"/>` : ""}`;
}

function svgDocument(width, height, label, body) {
  return `<!doctype html><html><body><svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><style>
    svg{background:#fff;color:#080808;font-family:Georgia,'Times New Roman',serif}.staff,.bar,.note,.ornament,.rest{stroke:#080808;stroke-width:3.2;stroke-linecap:round;stroke-linejoin:round}.staff{stroke-width:2}.bar{stroke-width:3}.repeat-thick{stroke:#080808;stroke-width:9}.beam{stroke:#080808;stroke-width:9}.beam.secondary{stroke-width:6}.ornament{stroke-width:2.7}.rest{stroke-width:5}.fill-none{fill:none}.meter{font-size:39px;font-weight:700}.tempo{font-size:30px}.section{font-size:34px;font-weight:700}.small{font-size:24px}.hand{font-family:'Comic Sans MS',cursive;font-size:30px}
  </style>${body}</svg></body></html>`;
}

function grooveFixture() {
  const top = 135;
  const xs = Array.from({ length: 8 }, (_, index) => 260 + index * 145);
  const cymbals = xs.map((x) => xNote(x, top - 9, top - 58)).join("");
  const lower = [
    drumNote(xs[0], top + 68, top + 118),
    drumNote(xs[3], top + 36, top + 98),
    drumNote(xs[4], top + 68, top + 118),
    drumNote(xs[5], top + 68, top + 118),
    drumNote(xs[7], top + 36, top + 98)
  ].join("");
  return svgDocument(1600, 340, "Synthetic clear four-four drum groove", `<text x="90" y="48" class="section">Clear 4/4 groove</text>${staff(top)}${clef(top)}${meter(top)}${barline(190, top)}${cymbals}${beam(xs[0] + 7, xs[3] + 7, top - 58)}${beam(xs[4] + 7, xs[7] + 7, top - 58)}${lower}${barline(1510, top)}`);
}

function cymbalFixture() {
  const top = 145;
  const crashX = 280;
  const hhXs = [460, 640, 820, 1000, 1180];
  const notes = xNote(crashX, top - 27, top - 78, { ledger: true }) + hhXs.map((x) => xNote(x, top - 10, top - 60)).join("");
  const snareXs = [640, 730, 910, 1270];
  const snares = drumNote(snareXs[0], top + 36, top + 100, { accent: true }) + drumNote(snareXs[1], top + 36, top + 100, { ghost: true }) + drumNote(snareXs[2], top + 36, top + 100, { ghost: true }) + drumNote(snareXs[3], top + 36, top + 100, { slash: true });
  const kicks = [280, 1000, 1180].map((x) => drumNote(x, top + 70, top + 125)).join("");
  return svgDocument(1600, 360, "Synthetic cymbal staff position example", `<text x="90" y="48" class="section">Cymbal position study</text>${staff(top)}${clef(top)}${meter(top, 3, 4)}${barline(190, top)}${notes}${beam(crashX + 7, hhXs[0] + 7, top - 78)}${beam(hhXs[1] + 7, hhXs[2] + 7, top - 60, true)}${beam(hhXs[3] + 7, hhXs[4] + 7, top - 60)}${snares}${kicks}${barline(1450, top)}`);
}

function ornamentFixture() {
  const top = 145;
  const xs = Array.from({ length: 8 }, (_, index) => 270 + index * 145);
  const cymbals = xs.map((x) => xNote(x, top - 10, top - 60)).join("");
  const flamX = xs[2];
  const diddleX = xs[6];
  const lower = drumNote(xs[0], top + 69, top + 125) + graceNote(flamX - 28, top + 23, flamX, top + 36) + drumNote(flamX, top + 36, top + 100) + quarterRest(xs[3], top + 56) + drumNote(diddleX, top + 36, top + 100, { slash: true });
  return svgDocument(1600, 360, "Synthetic ornament and lower voice rest example", `<text x="90" y="48" class="section">Ornament study</text>${staff(top)}${clef(top)}${meter(top)}${barline(190, top)}${cymbals}${beam(xs[0] + 7, xs[3] + 7, top - 60)}${beam(xs[4] + 7, xs[7] + 7, top - 60)}${lower}${barline(1500, top)}`);
}

function sectionRepeatFixture() {
  const top = 145;
  const barStart = 235;
  const middle = 850;
  const end = 1480;
  const xs = [320, 450, 580, 710, 940, 1070, 1200, 1330];
  const cymbals = xs.map((x) => xNote(x, top - 10, top - 60)).join("");
  const lower = [drumNote(xs[0], top + 68, top + 125), drumNote(xs[2], top + 36, top + 100), drumNote(xs[4], top + 68, top + 125), drumNote(xs[6], top + 36, top + 100)].join("");
  return svgDocument(1600, 350, "Synthetic two-bar paired section repeat", `<text x="90" y="48" class="section">Two-bar phrase</text>${staff(top)}${clef(top)}${meter(top)}${repeatBarline(barStart, top, "start")}${barline(middle, top)}${repeatBarline(end, top, "end")}${cymbals}${beam(xs[0] + 7, xs[3] + 7, top - 60)}${beam(xs[4] + 7, xs[7] + 7, top - 60)}${lower}`);
}

function twoTempoFixture() {
  const systems = [145, 375];
  const tempi = [92, 126];
  const labels = ["Opening", "Driving section"];
  const content = systems.map((top, systemIndex) => {
    const xs = Array.from({ length: 8 }, (_, index) => 280 + index * 145);
    const cymbalY = top - 10;
    const cymbals = xs.map((x, index) => systemIndex === 1 && index === 0 ? xNote(x, top - 27, top - 78, { ledger: true }) : xNote(x, cymbalY, top - 60)).join("");
    const lower = [drumNote(xs[0], top + 68, top + 125), drumNote(xs[3], top + 36, top + 100), drumNote(xs[4], top + 68, top + 125), drumNote(xs[7], top + 36, top + 100)].join("");
    return `<text x="90" y="${top - 48}" class="section">${labels[systemIndex]}</text><text x="350" y="${top - 48}" class="tempo">♩ = ${tempi[systemIndex]}</text>${staff(top)}${clef(top)}${meter(top)}${barline(190, top)}${barline(850, top)}${barline(1500, top)}${cymbals}${beam(xs[0] + 7, xs[3] + 7, top - 60)}${beam(xs[4] + 7, xs[7] + 7, top - 60)}${lower}`;
  }).join("");
  return svgDocument(1600, 590, "Synthetic complete chart with two tempo regions", content);
}

function handwritingFixture() {
  return svgDocument(1400, 420, "Synthetic unreadable handwritten drum notation", `<text x="70" y="55" class="hand" transform="rotate(-4 70 55)">maybe verse? 4-ish</text><path d="M 70 130 Q 250 92 420 145 T 780 120 T 1320 150 M 50 190 Q 240 235 420 180 T 850 210 T 1330 170 M 80 270 Q 300 220 490 295 T 850 255 T 1300 300" class="rest fill-none"/><g transform="rotate(9 700 210)">${xNote(300, 170, 105)}${xNote(540, 225, 150)}${drumNote(760, 205, 285)}${quarterRest(1020, 230)}</g><text x="1100" y="360" class="hand" transform="rotate(8 1100 360)">D.S.?? x?</text>`);
}

function navigationFixture() {
  const top = 150;
  const xs = Array.from({ length: 8 }, (_, index) => 270 + index * 145);
  const notes = xs.map((x) => xNote(x, top - 10, top - 60)).join("") + [xs[0], xs[3], xs[4], xs[7]].map((x, index) => drumNote(x, top + (index % 2 ? 36 : 68), top + 120)).join("");
  return svgDocument(1600, 340, "Synthetic endings and D S al Coda chart", `<text x="90" y="48" class="section">Verse and chorus route</text><text x="890" y="70" class="tempo">D.S. al Coda 𝄌</text>${staff(top)}${clef(top)}${meter(top)}${repeatBarline(210, top, "start")}${barline(840, top)}${repeatBarline(1490, top, "end")}${notes}${beam(xs[0] + 7, xs[3] + 7, top - 60)}${beam(xs[4] + 7, xs[7] + 7, top - 60)}<path d="M 850 118 L 850 82 L 1120 82" class="note fill-none"/><text x="870" y="112" class="small">1.</text><path d="M 1130 118 L 1130 82 L 1450 82" class="note fill-none"/><text x="1150" y="112" class="small">2.</text>`);
}

const rasterFixtures = [
  ["positive-01-clear-groove.png", grooveFixture()],
  ["positive-02-cymbal-positions.png", cymbalFixture()],
  ["positive-03-ornament-split-rest.png", ornamentFixture()],
  ["positive-04-section-repeat.png", sectionRepeatFixture()],
  ["positive-05-two-tempo-chart.png", twoTempoFixture()],
  ["negative-02-unreadable-handwriting.png", handwritingFixture()],
  ["negative-03-unsupported-navigation.png", navigationFixture()]
];

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [name, source] of rasterFixtures) {
    await page.setContent(source);
    await page.locator("svg").screenshot({ path: path.join(fixtureRoot, name), omitBackground: false });
    console.log(`Generated ${name}`);
  }
} finally {
  await browser.close();
}

const sampleRate = 8_000;
const durationSeconds = 1;
const sampleCount = sampleRate * durationSeconds;
const pcm = Buffer.alloc(sampleCount * 2);
for (let index = 0; index < sampleCount; index += 1) {
  const envelope = index < 1_200 ? Math.exp(-index / 220) : 0;
  const value = Math.round(Math.sin(2 * Math.PI * 110 * index / sampleRate) * envelope * 20_000);
  pcm.writeInt16LE(value, index * 2);
}
const wav = Buffer.alloc(44 + pcm.length);
wav.write("RIFF", 0);
wav.writeUInt32LE(36 + pcm.length, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(pcm.length, 40);
pcm.copy(wav, 44);
await writeFile(path.join(fixtureRoot, "negative-01-audio-input.wav"), wav);
console.log("Generated negative-01-audio-input.wav");
