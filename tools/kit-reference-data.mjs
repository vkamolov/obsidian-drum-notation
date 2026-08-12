const STAFF_POSITIONS = new Map([
  ["d/6", {
    order: 0,
    description: "space above the second ledger line",
    ledgerLineCount: 2,
    ledgerRelation: "below-notehead",
    ledgerEvidence: "two ledger lines below the notehead"
  }],
  ["c/6", {
    order: 1,
    description: "second ledger line above the staff",
    ledgerLineCount: 2,
    ledgerRelation: "through-notehead",
    ledgerEvidence: "two ledger lines; the second crosses the notehead"
  }],
  ["b/5", {
    order: 2,
    description: "space above the first ledger line",
    ledgerLineCount: 1,
    ledgerRelation: "below-notehead",
    ledgerEvidence: "one ledger line immediately below the notehead"
  }],
  ["a/5", {
    order: 3,
    description: "first ledger line above the staff",
    ledgerLineCount: 1,
    ledgerRelation: "through-notehead",
    ledgerEvidence: "one ledger line crosses the notehead"
  }],
  ["g/5", {
    order: 4,
    description: "space above the top staff line",
    ledgerLineCount: 0,
    ledgerRelation: "none",
    ledgerEvidence: "no ledger line"
  }],
  ["f/5", {
    order: 5,
    description: "top staff line",
    ledgerLineCount: 0,
    ledgerRelation: "none",
    ledgerEvidence: "no ledger line"
  }],
  ["e/5", {
    order: 6,
    description: "fourth staff space",
    ledgerLineCount: 0,
    ledgerRelation: "none",
    ledgerEvidence: "no ledger line"
  }],
  ["d/5", {
    order: 7,
    description: "fourth staff line",
    ledgerLineCount: 0,
    ledgerRelation: "none",
    ledgerEvidence: "no ledger line"
  }],
  ["c/5", {
    order: 8,
    description: "third staff space",
    ledgerLineCount: 0,
    ledgerRelation: "none",
    ledgerEvidence: "no ledger line"
  }],
  ["b/4", {
    order: 9,
    description: "middle staff line",
    ledgerLineCount: 0,
    ledgerRelation: "none",
    ledgerEvidence: "no ledger line"
  }],
  ["a/4", {
    order: 10,
    description: "second staff space",
    ledgerLineCount: 0,
    ledgerRelation: "none",
    ledgerEvidence: "no ledger line"
  }],
  ["g/4", {
    order: 11,
    description: "second staff line",
    ledgerLineCount: 0,
    ledgerRelation: "none",
    ledgerEvidence: "no ledger line"
  }],
  ["f/4", {
    order: 12,
    description: "first staff space",
    ledgerLineCount: 0,
    ledgerRelation: "none",
    ledgerEvidence: "no ledger line"
  }],
  ["e/4", {
    order: 13,
    description: "bottom staff line",
    ledgerLineCount: 0,
    ledgerRelation: "none",
    ledgerEvidence: "no ledger line"
  }],
  ["d/4", {
    order: 14,
    description: "space below the bottom staff line",
    ledgerLineCount: 0,
    ledgerRelation: "none",
    ledgerEvidence: "no ledger line"
  }]
]);

const NOTEHEAD_FAMILIES = new Map([
  [undefined, "normal"],
  ["X", "x"],
  ["d2", "diamond"]
]);

export function deriveVexStaffPosition(vexKey) {
  const match = /^([a-g])\/(\d+)(?:\/([A-Za-z0-9]+))?$/.exec(vexKey);
  if (!match) {
    throw new Error(`Unsupported VexFlow key format: ${vexKey}`);
  }

  const staffKey = `${match[1]}/${match[2]}`;
  const position = STAFF_POSITIONS.get(staffKey);
  if (!position) {
    throw new Error(`Unhandled percussion staff position: ${staffKey}`);
  }

  const suffix = match[3];
  const notehead = NOTEHEAD_FAMILIES.get(suffix);
  if (!notehead) {
    throw new Error(`Unsupported VexFlow notehead suffix: ${suffix}`);
  }

  return {
    staffKey,
    notehead,
    order: position.order,
    staffPosition: position.description,
    requiresLedgerLine: position.ledgerLineCount > 0,
    ledgerLines: {
      count: position.ledgerLineCount,
      relation: position.ledgerRelation,
      evidence: position.ledgerEvidence
    }
  };
}

export function enrichKitReference(kit) {
  return kit.map((instrument) => {
    if (!instrument || typeof instrument.vexKey !== "string") {
      throw new Error("Every DRUM_KIT entry must have a VexFlow key");
    }

    const derived = deriveVexStaffPosition(instrument.vexKey);
    return {
      ...instrument,
      staffPosition: derived.staffPosition,
      notehead: derived.notehead,
      requiresLedgerLine: derived.requiresLedgerLine,
      ledgerLines: derived.ledgerLines
    };
  });
}

export function buildXNoteheadLadder(kit) {
  const groups = new Map();

  for (const instrument of kit) {
    const derived = deriveVexStaffPosition(instrument.vexKey);
    if (derived.notehead !== "x") {
      continue;
    }

    const existing = groups.get(derived.staffKey);
    if (existing) {
      existing.instruments.push(instrument);
      continue;
    }

    groups.set(derived.staffKey, {
      vexKey: instrument.vexKey,
      order: derived.order,
      staffPosition: derived.staffPosition,
      ledgerEvidence: derived.ledgerLines.evidence,
      instruments: [instrument]
    });
  }

  return [...groups.values()].sort((left, right) => left.order - right.order);
}

export function formatXNoteheadLadder(kit) {
  const rows = buildXNoteheadLadder(kit).map((entry) => {
    const instruments = entry.instruments
      .map((instrument) => {
        const rowLabel = instrument.id === "stack" ? "STACK" : instrument.aliases[0].toUpperCase();
        return `${instrument.label} (\`${rowLabel}\`)`;
      })
      .join(", ");
    return `| ${instruments} | \`${entry.vexKey}\` | ${entry.staffPosition} | ${entry.ledgerEvidence} |`;
  });

  return [
    "## X-notehead staff-position ladder",
    "",
    "Use the source's printed legend or drum key when present. Otherwise use this generated Obsidian Drum Notation convention. Determine ledger-line evidence before using rhythmic context; repeated hi-hat rhythm must not override a distinct vertical cluster.",
    "",
    "| Instrument rows | VexFlow key | Staff position | Ledger-line evidence |",
    "| --- | --- | --- | --- |",
    ...rows,
    ""
  ].join("\n");
}
