import { describe, expect, it } from "vitest";
import { __recordStudioInternals } from "../components/RecordStudio";

const { finiteTimelineTimes, harMonotonicTimeToMs, harSnapshotStartTimeToMs, processNetworkEvents } =
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
});
