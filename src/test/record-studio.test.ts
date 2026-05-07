import { describe, expect, it } from "vitest";
import { __recordStudioInternals } from "../components/RecordStudio";

const { finiteTimelineTimes, harMonotonicTimeToMs, harSnapshotStartTimeToMs, normalizeActionCoords, processNetworkEvents } =
  __recordStudioInternals;

describe("RecordStudio trace timing", () => {
  it("converts HAR monotonic seconds to milliseconds", () => {
    expect(harMonotonicTimeToMs(1777754051.446)).toBe(1777754051446);
    expect(harMonotonicTimeToMs(1777754051446)).toBe(1777754051446);
  });

  it("falls back to startedDateTime for HAR snapshots without monotonic time", () => {
    expect(harSnapshotStartTimeToMs({ startedDateTime: "2026-05-02T20:34:11.446Z" })).toBe(1777754051446);
  });

  it("keeps HAR resource snapshots on the same timeline scale as trace actions", () => {
    const [entry] = processNetworkEvents([
      {
        type: "resource-snapshot",
        snapshot: {
          _monotonicTime: 1777754051.446,
          time: 12,
          request: { method: "GET", url: "http://localhost:8080/css/styles.css" },
          response: { status: 200, statusText: "OK", content: { mimeType: "text/css", size: 18744 } },
        },
      },
    ]);

    expect(entry.startTime).toBe(1777754051446);
    expect(entry.endTime).toBe(1777754051458);
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
