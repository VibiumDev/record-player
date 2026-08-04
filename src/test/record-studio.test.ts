import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { __recordStudioInternals } from "../components/RecordStudio";

const { advancePlayheadWithSkip, browserRecordingView, buildSkipIdleSegments, normalizeActionCoords } = __recordStudioInternals;

describe("RecordStudio core adapter", () => {
  it("uses player-core as its only archive parsing path", async () => {
    const source = await readFile(resolve(process.cwd(), "src/components/RecordStudio.jsx"), "utf8");
    expect(source).toContain('import { parseRecording } from "../packages/player-core"');
    expect(source).not.toContain('from "jszip"');
    expect(source).not.toContain("processTraceEvents");
    expect(source).toContain("Playwright trace.zip, or Twee");
  });

  it("adapts portable browser events without raw trace parsing", () => {
    const view = browserRecordingView({
      format: "playwright", metadata: { fileCount: 2, eventCount: 2 }, contexts: [], pages: [{ id: "page-1" }],
      timeline: { duration: 20, events: [
        { id: "action", kind: "action", time: 5, endTime: 8, data: {}, browser: { pageId: "page-1", apiName: "page.click", point: { x: 2, y: 3 } } },
        { id: "console", kind: "console", time: 7, data: {}, browser: { pageId: "page-1", text: "visible", messageType: "error" } },
      ], screenshots: [{ id: "frame", sha1: "frame", time: 6, pageId: "page-1", mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,frame" }] },
    });
    expect(view.actions[0]).toMatchObject({ apiName: "page.click", pageId: "page-1" });
    expect(view.console[0]).toMatchObject({ text: "visible", type: "error", pageId: "page-1" });
  });

  it("keeps existing skip-idle transport behavior", () => {
    expect(buildSkipIdleSegments({ duration: 10_000, actions: [{ startTime: 0, endTime: 10 }, { startTime: 9_990, endTime: 10_000 }] })).toEqual([{ start: 310, end: 9690, duration: 9380 }]);
    expect(advancePlayheadWithSkip(1900, 2100, [{ start: 2000, end: 10_000 }])).toBe(10_100);
  });

  it("uses an explicit coordinate boost for viewport-sized screenshots", () => {
    const norm = normalizeActionCoords({
      action: {
        point: { x: 640, y: 327.5 }, box: { x: 494, y: 303, width: 292, height: 49 },
        _snapshotMeta: { viewport: { width: 2560, height: 1440 }, scrollX: 0, scrollY: 0 }, _coordinateBoosts: [2],
      },
      screenshot: { width: 2560, height: 1440 }, viewport: { width: 2560, height: 1440 }, dpr: undefined,
      imgW: 1280, imgH: 720, natW: 2560, natH: 1440,
    });
    expect(norm?.boost).toBe(2);
    expect(norm?.px).toBeCloseTo(640);
    expect(norm?.py).toBeCloseTo(327.5);
    expect(norm?.bx).toBeCloseTo(494);
    expect(norm?.bh).toBeCloseTo(49);
  });
});
