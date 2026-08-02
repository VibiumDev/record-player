import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { __recordStudioInternals } from "../components/RecordStudio";

const {
  advancePlayheadWithSkip,
  buildSkipIdleSegments,
  finiteTimelineTimes,
  harMonotonicTimeToMs,
  harSnapshotStartTimeToMs,
  normalizeActionCoords,
  processTraceEvents,
  processNetworkEvents,
} =
  __recordStudioInternals;

describe("RecordStudio trace timing", () => {
  it("uses the bundled JSZip dependency instead of loading JSZip from a runtime CDN", async () => {
    const source = await readFile(resolve(process.cwd(), "src/components/RecordStudio.jsx"), "utf8");

    expect(source).toMatch(/from "jszip"/);
    expect(source).not.toContain("cdnjs.cloudflare.com/ajax/libs/jszip");
    expect(source).toContain('accept=".zip,.twee"');
    expect(source).toContain("or Twee");
  });

  it("reads HAR monotonic time as ms, rescaling only legacy epoch-seconds", () => {
    // Relative-ms (Playwright/current recordings, << 1e9) — returned raw, no scaling.
    expect(harMonotonicTimeToMs(915)).toBe(915);
    expect(harMonotonicTimeToMs(16581)).toBe(16581);
    expect(harMonotonicTimeToMs("12")).toBe(12);
    // Legacy absolute epoch SECONDS (~1.7e9) — rescaled to epoch-ms so it aligns
    // with action times. This is the #105 recording shape.
    expect(harMonotonicTimeToMs(1776351452.493)).toBe(1776351452493);
    // Absolute epoch MS (>= 1e12) — already ms, left untouched.
    expect(harMonotonicTimeToMs(1776351452390)).toBe(1776351452390);
    expect(harMonotonicTimeToMs(NaN)).toBe(0);
    expect(harMonotonicTimeToMs(undefined)).toBe(0);
  });

  it("falls back to startedDateTime for HAR snapshots without monotonic time", () => {
    expect(harSnapshotStartTimeToMs({ startedDateTime: "2026-05-02T20:34:11.446Z" })).toBe(1777754051446);
  });

  it("keeps HAR resource snapshots on the same timeline scale as trace actions (no 1000x inflation)", () => {
    // Fresh recording: actions span ~14.1s in relative-ms; a late network request has
    // _monotonicTime ~915 (relative-ms), NOT seconds.
    const actionStart = 12;
    const actionEnd = 14100;

    const [entry] = processNetworkEvents([
      {
        type: "resource-snapshot",
        snapshot: {
          _monotonicTime: 915,
          time: 43,
          request: { method: "GET", url: "http://localhost:8080/css/styles.css" },
          response: { status: 200, statusText: "OK", content: { mimeType: "text/css", size: 18744 } },
        },
      },
    ]);

    // Raw ms — not inflated to 915000.
    expect(entry.startTime).toBe(915);
    expect(entry.endTime).toBe(958);

    // Network entry sits within the action span, on the same scale.
    expect(entry.startTime).toBeGreaterThanOrEqual(actionStart);
    expect(entry.startTime).toBeLessThanOrEqual(actionEnd);

    // Bounds across actions + this network entry ≈ action span (~14.1s), not ~915s.
    // Mirrors the duration math at RecordStudio.jsx (minTime/maxTime over all timeline times).
    const allTimes = finiteTimelineTimes([actionStart, actionEnd, entry.startTime, entry.endTime]);
    const duration = Math.max(0, Math.max(...allTimes) - Math.min(...allTimes));
    expect(duration).toBe(actionEnd - actionStart); // 14088 ms (~14.1s)
    expect(duration).toBeLessThan(20000); // sanity: not inflated to ~900s
  });

  it("filters non-finite timeline values before calculating bounds", () => {
    expect(finiteTimelineTimes([0, 1, NaN, Infinity, -Infinity, "2"])).toEqual([0, 1, 2]);
  });

  it("builds skip-idle segments from gaps between recorded activity", () => {
    const segments = buildSkipIdleSegments(
      {
        duration: 10700,
        actions: [
          { startTime: 0, endTime: 250 },
          { startTime: 10500, endTime: 10700 },
        ],
        screenshots: [{ time: 300 }, { time: 10300 }],
        console: [{ time: 500 }],
        network: [],
        groups: [],
      },
      { thresholdMs: 2000, paddingMs: 300 },
    );

    expect(segments).toEqual([{ start: 800, end: 10000, duration: 9200 }]);
  });

  it("does not skip across DOM snapshot activity", () => {
    const segments = buildSkipIdleSegments(
      {
        duration: 10700,
        actions: [
          { startTime: 0, endTime: 250 },
          { startTime: 10500, endTime: 10700 },
        ],
        domSnapshots: [{ time: 5200 }],
        screenshots: [],
        console: [],
        network: [],
        groups: [],
      },
      { thresholdMs: 2000, paddingMs: 300 },
    );

    expect(segments).toEqual([
      { start: 550, end: 4900, duration: 4350 },
      { start: 5500, end: 10200, duration: 4700 },
    ]);
  });

  it("preserves frame-snapshot timestamps as DOM activity", () => {
    const { domSnapshots } = processTraceEvents([
      {
        type: "frame-snapshot",
        timestamp: 5200,
        snapshotName: "after-click",
        pageId: "page@1",
      },
    ]);

    expect(domSnapshots).toEqual([{ time: 5200, pageId: "page@1", name: "after-click" }]);
  });

  it("advances over skipped idle time without spending playback time inside it", () => {
    const segments = [{ start: 2000, end: 10000, duration: 8000 }];

    expect(advancePlayheadWithSkip(1900, 2100, segments)).toBe(10100);
    expect(advancePlayheadWithSkip(5000, 5200, segments)).toBe(10200);
    expect(advancePlayheadWithSkip(11000, 11200, segments)).toBe(11200);
  });

  it("uses inferred action coordinate boost for viewport-sized screenshots", () => {
    const norm = normalizeActionCoords({
      action: {
        point: { x: 640, y: 327.5 },
        box: { x: 494, y: 303, width: 292, height: 49 },
        _snapshotMeta: { viewport: { width: 2560, height: 1440 }, scrollX: 0, scrollY: 0 },
        _coordinateBoosts: [2],
      },
      screenshot: { width: 2560, height: 1440 },
      viewport: { width: 2560, height: 1440 },
      dpr: undefined,
      imgW: 1280,
      imgH: 720,
      natW: 2560,
      natH: 1440,
    });

    expect(norm?.boost).toBe(2);
    expect(norm?.px).toBeCloseTo(640);
    expect(norm?.py).toBeCloseTo(327.5);
    expect(norm?.bx).toBeCloseTo(494);
    expect(norm?.by).toBeCloseTo(303);
    expect(norm?.bw).toBeCloseTo(292);
    expect(norm?.bh).toBeCloseTo(49);
  });
});
