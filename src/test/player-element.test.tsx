import { describe, expect, it, vi, beforeEach } from "vitest";
import { defineVibiumRecordPlayerElement } from "../packages/player-element";

function okZipResponse() {
  // Invalid payload is enough for the element error path. Core parser tests cover valid zips.
  return new Response(new Uint8Array([1, 2, 3]), { status: 200, statusText: "OK" });
}

describe("player-element", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("defines the custom element idempotently", () => {
    const first = defineVibiumRecordPlayerElement();
    const second = defineVibiumRecordPlayerElement();
    expect(second).toBe(first);
    expect(customElements.get("vibium-record-player")).toBe(first);
  });

  it("upgrades and dispatches an error event when loading fails", async () => {
    defineVibiumRecordPlayerElement();
    vi.stubGlobal("fetch", vi.fn(async () => okZipResponse()));
    const errorHandler = vi.fn();
    const nativeErrorHandler = vi.fn();

    const element = document.createElement("vibium-record-player");
    element.setAttribute("src", "https://example.test/bad.zip");
    element.setAttribute("inspector", "hidden");
    element.addEventListener("vibium-player-error", errorHandler);
    element.addEventListener("error", nativeErrorHandler);

    document.body.appendChild(element);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(nativeErrorHandler).toHaveBeenCalledTimes(1);
    expect(errorHandler.mock.calls[0][0].detail.error).toBeInstanceOf(Error);
    element.setAttribute("timeline", "hidden");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetch).toHaveBeenCalledTimes(1);
    document.body.removeChild(element);
  });
});
