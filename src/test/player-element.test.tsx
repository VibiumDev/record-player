import { act, screen, waitFor } from "@testing-library/react";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defines the custom element idempotently", () => {
    const first = defineVibiumRecordPlayerElement();
    const second = defineVibiumRecordPlayerElement();
    expect(second).toBe(first);
    expect(customElements.get("vibium-record-player")).toBe(first);
  });

  it("renders the player and dispatches a ready event for a valid recording", async () => {
    defineVibiumRecordPlayerElement();
    const data = await readFile(resolve(process.cwd(), "public/vibium-demo-record.zip"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(data, { status: 200, statusText: "OK" })));
    const readyHandler = vi.fn();

    const element = document.createElement("vibium-record-player");
    element.setAttribute("src", "https://example.test/record.zip");
    element.addEventListener("vibium-player-ready", readyHandler);

    act(() => {
      document.body.appendChild(element);
    });

    expect(await screen.findByRole("button", { name: "Play recording" })).toBeInTheDocument();
    await waitFor(() => {
      expect(readyHandler).toHaveBeenCalledTimes(1);
    });

    const detail = readyHandler.mock.calls[0][0].detail;
    expect(detail.recording.version).toBe(1);
    expect(detail.recording.timeline.events.length).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledWith("https://example.test/record.zip", {
      credentials: "same-origin",
      signal: expect.any(AbortSignal),
    });

    act(() => {
      document.body.removeChild(element);
    });
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
