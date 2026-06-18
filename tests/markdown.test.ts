import { describe, expect, it } from "vitest";
import {
  getDrumsBlockEditStatus,
  getRenderedDrumsBlockEditStatus,
  replaceDrumsBlockBody
} from "../src/markdown";

describe("replaceDrumsBlockBody", () => {
  it("reports whether a rendered section is editable", () => {
    expect(getDrumsBlockEditStatus("```drums\nHH | x---\n```")).toEqual({ ok: true });
    expect(getDrumsBlockEditStatus("> ```drums\n> HH | x---\n> ```")).toEqual({
      ok: false,
      reason: "nested-or-indented-fence"
    });
  });

  it("accepts Obsidian body-only section text for rendered controls", () => {
    expect(getRenderedDrumsBlockEditStatus("HH | x---\nSD | --o-")).toEqual({ ok: true });
    expect(getRenderedDrumsBlockEditStatus("")).toEqual({ ok: true });
    expect(getRenderedDrumsBlockEditStatus("```drums\nHH | x---\n```")).toEqual({ ok: true });
  });

  it("refuses malformed and nested rendered fence sections", () => {
    expect(getRenderedDrumsBlockEditStatus("```drums")).toEqual({
      ok: false,
      reason: "missing-closing-fence"
    });
    expect(getRenderedDrumsBlockEditStatus("> ```drums\n> ```")).toEqual({
      ok: false,
      reason: "nested-or-indented-fence"
    });
    expect(getRenderedDrumsBlockEditStatus("- ```drums\n  ```")).toEqual({
      ok: false,
      reason: "nested-or-indented-fence"
    });
  });

  it("replaces a top-level drums fence body", () => {
    const input = ["before", "```drums", "HH | x---", "```", "after"].join("\n");
    const result = replaceDrumsBlockBody(input, { lineStart: 1, lineEnd: 3 }, "HH | x---", "HH | xxxx");

    expect(result).toEqual({
      ok: true,
      text: ["before", "```drums", "HH | xxxx", "```", "after"].join("\n")
    });
  });

  it("initializes an empty top-level drums fence without changing adjacent Markdown", () => {
    const input = ["before", "", "```drums", "```", "", "after"].join("\n");
    const body = ["Title: New groove", "HH | ----", "SD | ----", "BD | ----"].join("\n");
    const result = replaceDrumsBlockBody(input, { lineStart: 2, lineEnd: 3 }, "", body);

    expect(result).toEqual({
      ok: true,
      text: ["before", "", "```drums", body, "```", "", "after"].join("\n")
    });
  });

  it("replaces when Obsidian reports the inner body line range", () => {
    const input = ["before", "```drums", "HH | x---", "SD | --o-", "```", "after"].join("\n");
    const result = replaceDrumsBlockBody(input, { lineStart: 2, lineEnd: 3 }, "HH | x---\nSD | --o-", "HH | xxxx");

    expect(result).toEqual({
      ok: true,
      text: ["before", "```drums", "HH | xxxx", "```", "after"].join("\n")
    });
  });

  it("preserves surrounding markdown and only replaces the selected block", () => {
    const input = [
      "# Groove",
      "",
      "```drums",
      "HH | x---",
      "```",
      "",
      "```drums",
      "SD | ----",
      "```"
    ].join("\n");
    const result = replaceDrumsBlockBody(input, { lineStart: 6, lineEnd: 8 }, "SD | ----", "SD | --o-");

    expect(result).toEqual({
      ok: true,
      text: [
        "# Groove",
        "",
        "```drums",
        "HH | x---",
        "```",
        "",
        "```drums",
        "SD | --o-",
        "```"
      ].join("\n")
    });
  });

  it("preserves CRLF line endings around the replacement", () => {
    const input = "before\r\n```drums\r\nHH | x---\r\n```\r\nafter";
    const result = replaceDrumsBlockBody(input, { lineStart: 1, lineEnd: 3 }, "HH | x---", "HH | xxxx");

    expect(result).toEqual({
      ok: true,
      text: "before\r\n```drums\r\nHH | xxxx\r\n```\r\nafter"
    });
  });

  it("preserves a trailing newline after the closing fence", () => {
    const input = "```drums\nHH | x---\n```\n";
    const result = replaceDrumsBlockBody(input, { lineStart: 0, lineEnd: 2 }, "HH | x---", "HH | xxxx");

    expect(result).toEqual({
      ok: true,
      text: "```drums\nHH | xxxx\n```\n"
    });
  });

  it("refuses stale block bodies", () => {
    const input = ["```drums", "HH | x-x-", "```"].join("\n");
    const result = replaceDrumsBlockBody(input, { lineStart: 0, lineEnd: 2 }, "HH | x---", "HH | xxxx");

    expect(result).toEqual({ ok: false, reason: "stale-body" });
  });

  it("refuses indented or callout-prefixed fences", () => {
    const indented = ["  ```drums", "HH | x---", "  ```"].join("\n");
    const callout = ["> ```drums", "> HH | x---", "> ```"].join("\n");

    expect(replaceDrumsBlockBody(indented, { lineStart: 0, lineEnd: 2 }, "HH | x---", "HH | xxxx")).toEqual({
      ok: false,
      reason: "nested-or-indented-fence"
    });
    expect(replaceDrumsBlockBody(callout, { lineStart: 0, lineEnd: 2 }, "HH | x---", "HH | xxxx")).toEqual({
      ok: false,
      reason: "nested-or-indented-fence"
    });
  });

  it("refuses invalid sections and mismatched fences", () => {
    expect(replaceDrumsBlockBody("```drums\nHH | x---\n```", { lineStart: 2, lineEnd: 1 }, "", "")).toEqual({
      ok: false,
      reason: "invalid-section"
    });
    expect(replaceDrumsBlockBody("```ts\nHH | x---\n```", { lineStart: 0, lineEnd: 2 }, "HH | x---", "")).toEqual({
      ok: false,
      reason: "not-drums-fence"
    });
    expect(replaceDrumsBlockBody("````drums\nHH | x---\n```", { lineStart: 0, lineEnd: 2 }, "HH | x---", "")).toEqual({
      ok: false,
      reason: "missing-closing-fence"
    });
  });
});
