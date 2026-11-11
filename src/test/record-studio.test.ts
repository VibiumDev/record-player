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

describe("RecordStudio checkbox action names", () => {
  const { actionColor, humanizeAction, isHumanAction } = __recordStudioInternals;

  it("shows Vibium setters in the action filter with readable labels", () => {
    for (const [apiName, label] of [["Element.set", "Set"], ["Element.unset", "Unset"], ["vibium:element.set", "Set"]]) {
      expect(isHumanAction(apiName)).toBe(true);
      expect(humanizeAction({ apiName, params: { selector: "#consent" } })).toBe(`${label} #consent`);
      expect(actionColor(apiName)).toBe(actionColor("Locator.check"));
    }
    expect(isHumanAction("Cookies.set")).toBe(false);
    expect(isHumanAction("Clock.setFixedTime")).toBe(false);
  });

  it("retains Playwright checkbox names when displaying its recordings", () => {
    for (const [apiName, label] of [["Locator.check", "Check"], ["Locator.uncheck", "Uncheck"]]) {
      expect(isHumanAction(apiName)).toBe(true);
      expect(humanizeAction({ apiName, params: { selector: "#consent" } })).toBe(`${label} #consent`);
    }
  });
});

describe("RecordStudio coordinate boost inference", () => {
  it("infers a 2x boost when action coordinates fill only half the viewport", () => {
    const { inferActionCoordinateBoosts } = __recordStudioInternals;
    const actions: any[] = [
      { point: { x: 600, y: 300 }, box: { x: 500, y: 300, width: 140, height: 40 } },
      { point: { x: 100, y: 50 } },
    ];
    inferActionCoordinateBoosts(actions, { width: 1280, height: 720 });
    expect(actions[0]._coordinateBoosts).toEqual([2]);
  });
});

describe("RecordStudio pointer and audio", () => {
  const { isHumanAction, humanizePointer, wavPeaks, audibleSpans, buildSkipIdleSegments } = __recordStudioInternals as any;

  function wav(samples: number[], rate = 1000) {
    const buf = new ArrayBuffer(44 + samples.length * 2);
    const dv = new DataView(buf);
    const w = (o: number, t: string) => [...t].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF"); dv.setUint32(4, 36 + samples.length * 2, true); w(8, "WAVE");
    w(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    w(36, "data"); dv.setUint32(40, samples.length * 2, true);
    samples.forEach((v, i) => dv.setInt16(44 + i * 2, v, true));
    return new Uint8Array(buf);
  }

  it("treats Vibium pointer moves and releases as user actions", () => {
    expect(isHumanAction("vibium:hid.mouse_move")).toBe(true);
    expect(isHumanAction("vibium:hid.mouse_release")).toBe(true);
    expect(humanizePointer({ apiName: "vibium:hid.mouse_move", params: { inputs: [{ cmd: "mouse_move" }, { cmd: "mouse_move" }] } })).toBe("Pointer move ×2");
    expect(humanizePointer({ apiName: "vibium:hid.mouse_move", params: { inputs: [{ cmd: "mouse_move" }, { cmd: "mouse_click" }] } })).toBe("Pointer click");
  });

  it("does not skip idle time while audio is audible", () => {
    // 10s of silence at 1kHz with a loud stretch from 4s to 6s.
    const samples = Array.from({ length: 10_000 }, (_, i) => (i >= 4000 && i < 6000 ? 16000 : 0));
    const peaks = wavPeaks(wav(samples));
    const audio = { sounds: [{ kind: "heard", startTime: 0, peaks }] };
    expect(audibleSpans(audio)).toEqual([{ start: 4000, end: 6000 }]);
    const segs = buildSkipIdleSegments({ duration: 10_000, actions: [], audio });
    expect(segs).toEqual([{ start: 300, end: 3700, duration: 3400 }, { start: 6300, end: 9700, duration: 3400 }]);
  });
});
