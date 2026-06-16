export interface MarkdownSectionRange {
  lineStart: number;
  lineEnd: number;
}

export type ReplaceDrumsBlockFailure =
  | "invalid-section"
  | "nested-or-indented-fence"
  | "not-drums-fence"
  | "missing-closing-fence"
  | "stale-body";

export type ReplaceDrumsBlockResult =
  | {
      ok: true;
      text: string;
    }
  | {
      ok: false;
      reason: ReplaceDrumsBlockFailure;
    };

export type DrumsBlockEditStatus =
  | {
      ok: true;
    }
  | {
      ok: false;
      reason: ReplaceDrumsBlockFailure;
    };

interface MarkdownLine {
  content: string;
  eol: string;
}

interface ResolvedDrumsBlockRange {
  ok: true;
  openingIndex: number;
  closingIndex: number;
  bodyStart: number;
  bodyEnd: number;
}

export function replaceDrumsBlockBody(
  markdown: string,
  section: MarkdownSectionRange,
  expectedBody: string,
  nextBody: string
): ReplaceDrumsBlockResult {
  const lines = splitMarkdownLines(markdown);

  if (
    section.lineStart < 0 ||
    section.lineEnd >= lines.length ||
    section.lineStart > section.lineEnd ||
    !Number.isInteger(section.lineStart) ||
    !Number.isInteger(section.lineEnd)
  ) {
    return { ok: false, reason: "invalid-section" };
  }

  const range = resolveDrumsBlockRange(lines, section);
  if (!range.ok) {
    return range;
  }

  const currentBody = lines
    .slice(range.bodyStart, range.bodyEnd)
    .map((line) => line.content)
    .join("\n");

  if (normalizeLineEndings(currentBody) !== normalizeLineEndings(expectedBody)) {
    return { ok: false, reason: "stale-body" };
  }

  const bodyLines = normalizeLineEndings(nextBody).length > 0 ? normalizeLineEndings(nextBody).split("\n") : [];
  const opening = lines[range.openingIndex].content;
  const closing = lines[range.closingIndex].content;
  const eol = lines[range.openingIndex].eol || inferLineEnding(markdown);
  const replacement: MarkdownLine[] = [
    { content: opening, eol },
    ...bodyLines.map((content) => ({ content, eol })),
    { content: closing, eol: lines[range.closingIndex].eol }
  ];

  return {
    ok: true,
    text: [...lines.slice(0, range.openingIndex), ...replacement, ...lines.slice(range.closingIndex + 1)]
      .map((line) => line.content + line.eol)
      .join("")
  };
}

export function getDrumsBlockEditStatus(sectionText: string): DrumsBlockEditStatus {
  const lines = splitMarkdownLines(sectionText);

  if (lines.length < 2) {
    return { ok: false, reason: "invalid-section" };
  }

  return getDrumsFenceStatus(lines[0].content, lines[lines.length - 1].content);
}

function resolveDrumsBlockRange(
  lines: MarkdownLine[],
  section: MarkdownSectionRange
): ResolvedDrumsBlockRange | { ok: false; reason: ReplaceDrumsBlockFailure } {
  if (section.lineStart < section.lineEnd) {
    const fullFenceStatus = getDrumsFenceStatus(lines[section.lineStart].content, lines[section.lineEnd].content);

    if (fullFenceStatus.ok) {
      return {
        ok: true,
        openingIndex: section.lineStart,
        closingIndex: section.lineEnd,
        bodyStart: section.lineStart + 1,
        bodyEnd: section.lineEnd
      };
    }

    if (fullFenceStatus.reason === "nested-or-indented-fence" || isFenceLikeLine(lines[section.lineStart].content)) {
      return fullFenceStatus;
    }
  }

  const openingIndex = section.lineStart - 1;
  const closingIndex = section.lineEnd + 1;

  if (openingIndex < 0 || closingIndex >= lines.length) {
    return { ok: false, reason: "invalid-section" };
  }

  const innerFenceStatus = getDrumsFenceStatus(lines[openingIndex].content, lines[closingIndex].content);
  if (!innerFenceStatus.ok) {
    return innerFenceStatus;
  }

  return {
    ok: true,
    openingIndex,
    closingIndex,
    bodyStart: section.lineStart,
    bodyEnd: section.lineEnd + 1
  };
}

function isFenceLikeLine(line: string): boolean {
  return /^`{3,}/.test(line);
}

function splitMarkdownLines(markdown: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let index = 0;

  while (index < markdown.length) {
    let lineEnd = index;
    while (lineEnd < markdown.length && markdown[lineEnd] !== "\n" && markdown[lineEnd] !== "\r") {
      lineEnd++;
    }

    const content = markdown.slice(index, lineEnd);
    let eol = "";

    if (lineEnd < markdown.length) {
      if (markdown[lineEnd] === "\r" && markdown[lineEnd + 1] === "\n") {
        eol = "\r\n";
        lineEnd += 2;
      } else {
        eol = markdown[lineEnd];
        lineEnd += 1;
      }
    }

    lines.push({ content, eol });
    index = lineEnd;
  }

  return lines;
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function inferLineEnding(markdown: string): string {
  const match = markdown.match(/\r\n|\n|\r/);
  return match?.[0] ?? "\n";
}

function getDrumsFenceStatus(opening: string, closing: string): DrumsBlockEditStatus {
  if (/^\s/.test(opening) || opening.startsWith(">")) {
    return { ok: false, reason: "nested-or-indented-fence" };
  }

  const openMatch = opening.match(/^(`{3,})\s*drums\s*$/i);
  if (!openMatch) {
    return { ok: false, reason: "not-drums-fence" };
  }

  const fence = openMatch[1];
  if (!new RegExp(`^${escapeRegExp(fence)}\\s*$`).test(closing)) {
    return { ok: false, reason: "missing-closing-fence" };
  }

  return { ok: true };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
