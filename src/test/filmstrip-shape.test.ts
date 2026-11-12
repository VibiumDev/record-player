import { describe, expect, it } from "vitest";

import { __recordStudioInternals } from "../components/RecordStudio";

const { filmstripShape, previewSize } = __recordStudioInternals;

const phone = { width: 886, height: 1920 };
const desktop = { width: 1280, height: 720 };

describe("the filmstrip's thumbnails", () => {
  it("are tall when the frames are a phone's", () => {
    const shape = filmstripShape([phone, phone, phone]);
    expect(shape.height).toBe(64);
    expect(shape.width).toBe(Math.round((64 * 886) / 1920));
    expect(shape.aspect).toBeCloseTo(886 / 1920);
  });

  it("are wide when the frames are a desktop's", () => {
    expect(filmstripShape([desktop, desktop])).toMatchObject({ height: 40, width: 71 });
  });

  it("take the shape most frames have, and that group's own ratio", () => {
    const turned = { width: 1920, height: 886 };
    const shape = filmstripShape([phone, phone, turned, phone]);
    expect(shape.height).toBe(64);
    expect(shape.aspect).toBeCloseTo(886 / 1920);
    expect(filmstripShape([phone, turned, turned]).height).toBe(40);
  });

  it("fall back to a loaded frame's shape, then to the old 64 by 40", () => {
    expect(filmstripShape([{}, {}], 0.5)).toMatchObject({ height: 64, width: 32 });
    expect(filmstripShape([{}, { width: 0, height: 0 }])).toMatchObject({ height: 40, width: 64 });
  });

  it("stay within 24 and 96 wide", () => {
    expect(filmstripShape([{ width: 100, height: 1000 }]).width).toBe(24);
    expect(filmstripShape([{ width: 4000, height: 500 }]).width).toBe(96);
  });
});

describe("the hover preview", () => {
  it("is 320 wide for a wide frame", () => {
    expect(previewSize(16 / 9, 600)).toEqual({ width: 320, height: 180 });
  });

  it("keeps a tall frame whole inside the room above the filmstrip", () => {
    const size = previewSize(886 / 1920, 400);
    expect(size.height).toBe(400);
    expect(size.width).toBe(Math.round((400 * 886) / 1920));
  });

  it("is never taller than 480 or shorter than 120", () => {
    expect(previewSize(0.46, 2000).height).toBe(480);
    expect(previewSize(0.46, 10).height).toBe(120);
  });
});
