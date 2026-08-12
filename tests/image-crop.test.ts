import { describe, expect, it } from "vitest";
import {
  getClampedDisplaySelection,
  getContainedImageRect,
  getFocusedCropOutputSize,
  mapDisplaySelectionToSource
} from "../web/src/image-crop";

describe("focused source-image cropping", () => {
  it("fits wide images into a letterboxed stage", () => {
    expect(getContainedImageRect(
      { width: 400, height: 300 },
      { width: 800, height: 200 }
    )).toEqual({ x: 0, y: 100, width: 400, height: 100 });
  });

  it("maps a scaled letterboxed selection to source pixels", () => {
    expect(getClampedDisplaySelection(
      { x: 100, y: 125 },
      { x: 300, y: 175 },
      { width: 400, height: 300 },
      { width: 800, height: 200 }
    )).toEqual({ x: 100, y: 125, width: 200, height: 50 });
    expect(mapDisplaySelectionToSource(
      { x: 100, y: 125 },
      { x: 300, y: 175 },
      { width: 400, height: 300 },
      { width: 800, height: 200 }
    )).toEqual({ x: 200, y: 50, width: 400, height: 100 });
  });

  it("clamps selections to the displayed image", () => {
    expect(mapDisplaySelectionToSource(
      { x: -20, y: 20 },
      { x: 450, y: 280 },
      { width: 400, height: 300 },
      { width: 800, height: 200 }
    )).toEqual({ x: 0, y: 0, width: 800, height: 200 });
  });

  it("rejects empty, tiny, and invalid selections", () => {
    expect(mapDisplaySelectionToSource(
      { x: 100, y: 100 },
      { x: 101, y: 101 },
      { width: 400, height: 300 },
      { width: 800, height: 200 }
    )).toBeNull();
    expect(getContainedImageRect({ width: 0, height: 300 }, { width: 800, height: 200 })).toBeNull();
  });

  it("enlarges up to four times without exceeding 2048 pixels", () => {
    expect(getFocusedCropOutputSize({ width: 200, height: 100 })).toEqual({ width: 800, height: 400 });
    expect(getFocusedCropOutputSize({ width: 1000, height: 500 })).toEqual({ width: 2048, height: 1024 });
    expect(getFocusedCropOutputSize({ width: 4096, height: 1024 })).toEqual({ width: 2048, height: 512 });
    expect(getFocusedCropOutputSize({ width: 0, height: 100 })).toBeNull();
  });
});
