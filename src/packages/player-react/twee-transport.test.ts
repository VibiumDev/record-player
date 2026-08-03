import { describe, expect, it } from "vitest";

import { advanceTweePlayhead, TWEE_MAX_IDLE_MS } from "./twee-transport";

describe("advanceTweePlayhead", () => {
  it("caps a delayed first event before adding the animation frame elapsed time", () => {
    expect(advanceTweePlayhead(0, 16, [10_000], 10_000)).toBe(8_016);
  });

  it("does not skip gaps at or below Twee's two second default", () => {
    expect(advanceTweePlayhead(0, 16, [1_999], 3_000)).toBe(16);
    expect(advanceTweePlayhead(0, 16, [2_000], 3_000)).toBe(16);
  });

  it("caps each long gap independently while retaining raw event timestamps", () => {
    expect(advanceTweePlayhead(0, 100, [5_000, 12_000], 12_000)).toBe(3_100);
    expect(advanceTweePlayhead(5_000, 100, [5_000, 12_000], 12_000)).toBe(10_100);
  });

  it("does not skip when no event remains and clamps at the raw duration", () => {
    expect(advanceTweePlayhead(9_000, 2_000, [1_000, 9_000], 10_000)).toBe(10_000);
  });

  it("accepts an explicit zero cap and defensive invalid values", () => {
    expect(advanceTweePlayhead(0, 10, [10_000], 10_000, 0)).toBe(10);
    expect(advanceTweePlayhead(Number.NaN, -1, [10_000], 10_000)).toBe(8_000);
  });

  it("uses Twee's default two second cap", () => {
    expect(TWEE_MAX_IDLE_MS).toBe(2_000);
  });
});
