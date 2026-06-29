import { DrumArticulation, DrumInstrument } from "./types";
import { normalizeLabel } from "./util";

export const DRUM_KIT: DrumInstrument[] = [
  {
    id: "crash",
    label: "Crash",
    aliases: ["cr", "crash", "cc", "crash cymbal"],
    vexKey: "a/5/X",
    midi: 49,
    color: "#d97706",
    playback: "crash"
  },
  {
    id: "splash",
    label: "Splash",
    aliases: ["sp", "splash", "splash cymbal"],
    vexKey: "b/5/X",
    midi: 55,
    color: "#f59e0b",
    playback: "splash"
  },
  {
    id: "china",
    label: "China",
    aliases: ["chna", "china", "china cymbal"],
    vexKey: "c/6/X",
    midi: 52,
    color: "#ea580c",
    playback: "china"
  },
  {
    id: "stack",
    label: "Stack",
    aliases: ["st", "stack", "stack cymbal"],
    vexKey: "d/6/X",
    midi: 52,
    color: "#c2410c",
    playback: "stack"
  },
  {
    id: "ride",
    label: "Ride",
    aliases: ["rd", "ride", "rc"],
    vexKey: "f/5/X",
    midi: 51,
    color: "#b45309",
    playback: "ride"
  },
  {
    id: "ride-bell",
    label: "Ride bell",
    aliases: ["rb", "bell", "ridebell", "ride bell"],
    vexKey: "e/5/X",
    midi: 53,
    color: "#92400e",
    playback: "rideBell"
  },
  {
    id: "open-hat",
    label: "Open hat",
    aliases: ["oh", "openhat", "open-hat", "open hh"],
    vexKey: "g/5/X",
    midi: 46,
    color: "#ca8a04",
    playback: "hatOpen"
  },
  {
    id: "half-open-hat",
    label: "Half-open hat",
    aliases: ["ho", "hho", "halfopenhat", "half-openhat", "half open hat", "half-open hat", "half open hi-hat", "half-open hi-hat"],
    vexKey: "g/5/X",
    midi: 46,
    color: "#d4a017",
    playback: "hatHalfOpen"
  },
  {
    id: "closed-hat",
    label: "Hi-hat",
    aliases: ["hh", "ch", "close", "closed", "hat", "hihat", "hi-hat", "closedhat", "closed-hat"],
    vexKey: "g/5/X",
    midi: 42,
    color: "#eab308",
    playback: "hatClosed"
  },
  {
    id: "hi-hat-foot",
    label: "Hi-hat foot",
    aliases: ["hf", "hhf", "fh", "foot hat", "hat foot", "hi-hat foot", "hihat foot"],
    vexKey: "d/4/X",
    midi: 44,
    color: "#a16207",
    playback: "hatFoot"
  },
  {
    id: "hi-hat-foot-splash",
    label: "Hi-hat foot splash",
    aliases: ["hfs", "hhfs", "foot splash", "hat foot splash", "hi-hat foot splash", "hihat foot splash", "hi-hat splash", "hihat splash"],
    vexKey: "d/4/X",
    midi: 44,
    color: "#854d0e",
    playback: "hatFootSplash"
  },
  {
    id: "snare",
    label: "Snare",
    aliases: ["sd", "sn", "snare"],
    vexKey: "c/5",
    midi: 38,
    color: "#2563eb",
    playback: "snare"
  },
  {
    id: "rim",
    label: "Rim",
    aliases: ["rs", "rim", "rimshot", "xstick", "cross", "crossstick", "cross-stick"],
    vexKey: "c/5/X",
    midi: 37,
    color: "#0891b2",
    playback: "click"
  },
  {
    id: "high-tom",
    label: "High rack tom",
    aliases: ["ht", "rt", "rt1", "t1", "tom1", "rack", "rack tom", "high tom", "high rack tom"],
    vexKey: "e/5",
    midi: 50,
    color: "#16a34a",
    playback: "tomHigh"
  },
  {
    id: "mid-tom",
    label: "Mid rack tom",
    aliases: ["mt", "rt2", "t2", "tom2", "mid tom", "mid rack tom"],
    vexKey: "d/5",
    midi: 47,
    color: "#15803d",
    playback: "tomMid"
  },
  {
    id: "low-tom",
    label: "Low rack tom",
    aliases: ["lt", "rt3", "t3", "tom3", "low tom", "low rack tom"],
    vexKey: "a/4",
    midi: 45,
    color: "#166534",
    playback: "tomLow"
  },
  {
    id: "floor-tom",
    label: "Floor tom",
    aliases: ["ft", "floor", "floor tom"],
    vexKey: "g/4",
    midi: 41,
    color: "#14532d",
    playback: "tomLow"
  },
  {
    id: "low-floor-tom",
    label: "Low floor tom",
    aliases: ["lft", "ft2", "low floor", "low floor tom"],
    vexKey: "e/4",
    midi: 43,
    color: "#052e16",
    playback: "tomLow"
  },
  {
    id: "kick",
    label: "Kick",
    aliases: ["bd", "kd", "kick", "bass", "bass drum"],
    vexKey: "f/4",
    midi: 36,
    color: "#dc2626",
    playback: "kick"
  },
  {
    id: "second-kick",
    label: "Second kick",
    aliases: ["bd2", "kd2", "kick2", "bass2", "bass drum 2", "second kick", "second bass", "second bass drum"],
    vexKey: "d/4",
    midi: 36,
    color: "#ef4444",
    playback: "kick"
  },
  {
    id: "cowbell",
    label: "Cowbell",
    aliases: ["cb", "cowbell"],
    vexKey: "e/5/X",
    midi: 56,
    color: "#7c3aed",
    playback: "cowbell"
  }
];

export const INSTRUMENTS_BY_ALIAS = new Map<string, DrumInstrument>(
  DRUM_KIT.flatMap((instrument) => [
    [normalizeLabel(instrument.label), instrument] as [string, DrumInstrument],
    ...instrument.aliases.map((alias): [string, DrumInstrument] => [normalizeLabel(alias), instrument])
  ])
);

const DEFAULT_ARTICULATIONS: DrumArticulation[] = ["normal", "accent"];
const CYMBAL_ARTICULATIONS: DrumArticulation[] = ["normal", "accent", "choke"];
const SNARE_ARTICULATIONS: DrumArticulation[] = ["normal", "accent", "ghost", "flam", "drag", "diddle", "buzz"];
const TOM_ARTICULATIONS: DrumArticulation[] = ["normal", "accent", "flam", "drag", "diddle"];
const KICK_ARTICULATIONS: DrumArticulation[] = ["normal", "accent", "flam"];

const CYMBAL_INSTRUMENT_IDS = new Set(["crash", "splash", "china", "stack", "ride"]);
const TOM_INSTRUMENT_IDS = new Set(["high-tom", "mid-tom", "low-tom", "floor-tom", "low-floor-tom"]);
const KICK_INSTRUMENT_IDS = new Set(["kick", "second-kick"]);

// Instrument-aware articulation capabilities for visual editors. This keeps
// the model alphabet global while letting UI surfaces offer only useful choices
// for the selected voice.
export function getAllowedArticulations(instrument: DrumInstrument): DrumArticulation[] {
  if (CYMBAL_INSTRUMENT_IDS.has(instrument.id)) {
    return [...CYMBAL_ARTICULATIONS];
  }

  if (instrument.id === "snare") {
    return [...SNARE_ARTICULATIONS];
  }

  if (TOM_INSTRUMENT_IDS.has(instrument.id)) {
    return [...TOM_ARTICULATIONS];
  }

  if (KICK_INSTRUMENT_IDS.has(instrument.id)) {
    return [...KICK_ARTICULATIONS];
  }

  return [...DEFAULT_ARTICULATIONS];
}

export function isArticulationAllowed(instrument: DrumInstrument, articulation: DrumArticulation): boolean {
  return getAllowedArticulations(instrument).includes(articulation);
}

// The pattern "alphabet": every notation character maps to a single articulation,
// and every articulation maps to a single playback velocity. Keeping these in one
// place means the grammar is documented and testable in exactly one spot.
const ARTICULATION_BY_CHAR: Record<string, DrumArticulation> = {
  z: "buzz",
  Z: "buzz",
  O: "accent",
  X: "accent",
  "!": "accent",
  "#": "accent",
  ">": "accent",
  g: "ghost",
  f: "flam",
  r: "drag",
  d: "diddle",
  c: "choke"
};

const VELOCITY_BY_ARTICULATION: Record<DrumArticulation, number> = {
  normal: 0.75,
  accent: 1,
  ghost: 0.4,
  flam: 0.75,
  drag: 0.75,
  diddle: 0.75,
  buzz: 0.68,
  choke: 0.9
};

const REST_CHARS = new Set(["-", ".", "_", " "]);

export function getArticulation(value: string): DrumArticulation {
  return ARTICULATION_BY_CHAR[value] ?? "normal";
}

export function getArticulationForKey(value: string): DrumArticulation | null {
  if (value === "x" || value === "o") {
    return "normal";
  }

  return ARTICULATION_BY_CHAR[value] ?? null;
}

export function getVelocity(value: string): number {
  return VELOCITY_BY_ARTICULATION[getArticulation(value)];
}

export function isRest(value: string): boolean {
  return REST_CHARS.has(value);
}

// Cross noteheads (cymbals, hi-hats, cross-stick) are written with x/X by
// convention; drum voices use o/O. The notehead lives in the vexKey suffix.
export function isCrossNotehead(instrument: DrumInstrument): boolean {
  return instrument.vexKey.includes("/X");
}

// The canonical character the serializer emits for a hit. Several input
// characters share one articulation (e.g. >, !, #, X, O are all accents); this
// picks one deterministic representative so output is normalized but still
// re-parses to the same articulation. Inverse of ARTICULATION_BY_CHAR.
export function getHitChar(instrument: DrumInstrument, articulation: DrumArticulation): string {
  const cross = isCrossNotehead(instrument);

  switch (articulation) {
    case "accent":
      return cross ? "X" : "O";
    case "ghost":
      return "g";
    case "flam":
      return "f";
    case "drag":
      return "r";
    case "diddle":
      return "d";
    case "buzz":
      return "z";
    case "choke":
      return "c";
    case "normal":
    default:
      return cross ? "x" : "o";
  }
}

// Rewrites one source character into its canonical form for the given
// instrument: rests collapse to "-", hits map through their articulation.
export function normalizeHitChar(instrument: DrumInstrument, value: string): string {
  return isRest(value) ? "-" : getHitChar(instrument, getArticulation(value));
}

// Normalizes a whole pattern string, one character at a time.
export function normalizePattern(instrument: DrumInstrument, pattern: string): string {
  return Array.from(pattern, (char) => normalizeHitChar(instrument, char)).join("");
}
