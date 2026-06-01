import { describe, expect, it } from "vitest";
import { __recordStudioInternals } from "../components/RecordStudio";

const { finiteTimelineTimes, harMonotonicTimeToMs, harSnapshotStartTimeToMs, normalizeActionCoords, processNetworkEvents } =
  __recordStudioInternals;

describe("RecordStudio trace timing", () => {
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
