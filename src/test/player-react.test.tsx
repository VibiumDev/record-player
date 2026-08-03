import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecordPlayer } from "../packages/player-react";
import type { LoadedRecording } from "../packages/player-core";

const originalRequestFullscreen = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "requestFullscreen");
const originalExitFullscreen = Object.getOwnPropertyDescriptor(document, "exitFullscreen");
const originalFullscreenElement = Object.getOwnPropertyDescriptor(document, "fullscreenElement");

function restoreFullscreenAPI() {
  for (const [target, key, descriptor] of [
    [HTMLElement.prototype, "requestFullscreen", originalRequestFullscreen],
    [document, "exitFullscreen", originalExitFullscreen],
    [document, "fullscreenElement", originalFullscreenElement],
  ] as const) {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else delete (target as Record<string, unknown>)[key];
  }
}

function recording(): LoadedRecording {
  return {
    version: 1,
    format: "vibium",
    presentation: { kind: "screenshot" },
    source: "sample.zip",
    files: ["trace.trace", "resources/page.jpeg"],
    metadata: {
      fileCount: 2,
      eventCount: 2,
      traceEventCount: 2,
      networkEventCount: 0,
    },
    timeline: {
      startTime: 0,
      endTime: 1000,
      duration: 1000,
      events: [
        { id: "event-1", kind: "action", type: "click", title: "Click button", time: 0, data: {} },
        { id: "event-2", kind: "screenshot", type: "screencast-frame", title: "Frame", time: 1000, data: {} },
      ],
      screenshots: [
        { id: "screenshot-1", sha1: "first", time: 0, mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,first" },
        { id: "screenshot-2", sha1: "second", time: 1000, mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,second" },
      ],
    },
    raw: { traceEvents: [], networkEvents: [] },
  };
}

describe("RecordPlayer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    restoreFullscreenAPI();
  });

  it("shows playback controls and toggles play state", () => {
    render(<RecordPlayer recording={recording()} timeline="hidden" inspector="hidden" />);

    const play = screen.getByRole("button", { name: "Play recording" });
    expect(play).toBeInTheDocument();

    fireEvent.click(play);

    expect(screen.getByRole("button", { name: "Pause recording" })).toBeInTheDocument();
  });

  it("renders both play/pause labels stacked so the button width never changes", () => {
    render(<RecordPlayer recording={recording()} timeline="hidden" inspector="hidden" />);

    const button = screen.getByRole("button", { name: "Play recording" });
    const labels = Array.from(button.querySelectorAll("span")).map((span) => ({
      text: span.textContent,
      hidden: span.style.visibility === "hidden",
    }));
    expect(labels).toEqual([
      { text: "❚❚ Pause", hidden: true },
      { text: "▶ Play", hidden: false },
    ]);

    fireEvent.click(button);

    const paused = Array.from(
      screen.getByRole("button", { name: "Pause recording" }).querySelectorAll("span"),
    ).map((span) => ({ text: span.textContent, hidden: span.style.visibility === "hidden" }));
    expect(paused).toEqual([
      { text: "❚❚ Pause", hidden: false },
      { text: "▶ Play", hidden: true },
    ]);
  });

  it("reserves a fixed-width elapsed label so the slider does not resize during playback", () => {
    render(<RecordPlayer recording={recording()} timeline="hidden" inspector="hidden" />);

    // Widest possible label for this recording is the formatted duration
    // ("1.00s" = 5 characters); the elapsed label must hold that width from
    // the start or the flexed slider re-lays-out on every tick.
    const elapsed = screen.getByText("0ms");
    expect(elapsed).toHaveStyle({
      width: "5ch",
      textAlign: "right",
      fontVariantNumeric: "tabular-nums",
    });
  });

  it("seeks to screenshots with the playback slider", () => {
    render(<RecordPlayer recording={recording()} timeline="hidden" inspector="hidden" />);

    fireEvent.change(screen.getByRole("slider", { name: "Playback position" }), { target: { value: "1000" } });

    expect(screen.getByText("Screenshot at 1.00s")).toBeInTheDocument();
    expect(screen.getByAltText("Current recording screenshot")).toHaveAttribute("src", "data:image/jpeg;base64,second");
  });

  it("enters and exits fullscreen while keeping the player state synchronized", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const exitFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { configurable: true, value: requestFullscreen });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exitFullscreen });
    let fullscreenElement: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreenElement });

    render(<RecordPlayer recording={recording()} timeline="hidden" inspector="hidden" />);
    fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    expect(requestFullscreen).toHaveBeenCalledTimes(1);

    const root = screen.getByRole("heading", { name: "Record Player" }).closest("section");
    fullscreenElement = root;
    fireEvent(document, new Event("fullscreenchange"));
    expect(screen.getByRole("button", { name: "Exit fullscreen" })).toBeInTheDocument();
    expect(screen.getByTestId("screenshot-presentation")).toHaveStyle({ flex: "1 1 0" });

    fireEvent.click(screen.getByRole("button", { name: "Exit fullscreen" }));
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    fullscreenElement = null;
    fireEvent(document, new Event("fullscreenchange"));
    expect(screen.getByRole("button", { name: "Enter fullscreen" })).toBeInTheDocument();
  });

  it("reports a rejected fullscreen request", async () => {
    const requestFullscreen = vi.fn().mockRejectedValue(new Error("blocked"));
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { configurable: true, value: requestFullscreen });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: vi.fn().mockResolvedValue(undefined) });

    render(<RecordPlayer recording={recording()} timeline="hidden" inspector="hidden" />);
    fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    await screen.findByRole("status");
    expect(screen.getByRole("status")).toHaveTextContent("Fullscreen is unavailable");
  });

  it("reports a native fullscreen error event", () => {
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { configurable: true, value: vi.fn() });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: vi.fn() });
    render(<RecordPlayer recording={recording()} timeline="hidden" inspector="hidden" />);
    fireEvent(document, new Event("fullscreenerror"));
    expect(screen.getByRole("status")).toHaveTextContent("Fullscreen is unavailable");
  });

  it("does not render fullscreen controls when the browser API is unavailable", () => {
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { configurable: true, value: undefined });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: undefined });
    render(<RecordPlayer recording={recording()} timeline="hidden" inspector="hidden" />);
    expect(screen.queryByRole("button", { name: "Enter fullscreen" })).not.toBeInTheDocument();
  });

  it("caps a Twee idle gap on its first animation frame but leaves Vibium timing unchanged", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(performance, "now").mockReturnValue(0);

    const delayedVibium: LoadedRecording = {
      ...recording(),
      timeline: {
        ...recording().timeline,
        endTime: 10_000,
        duration: 10_000,
        events: [{ id: "late", kind: "screenshot", type: "screencast-frame", title: "Late frame", time: 10_000, data: {} }],
        screenshots: [{ id: "late", sha1: "late", time: 10_000, mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,late" }],
      },
    };

    const { unmount } = render(<RecordPlayer recording={delayedVibium} timeline="hidden" inspector="hidden" />);
    fireEvent.click(screen.getByRole("button", { name: "Play recording" }));
    expect(frame).toBeDefined();
    act(() => frame?.(16));
    expect(screen.getByRole("slider", { name: "Playback position" })).toHaveValue("16");
    unmount();

    const delayedTwee: LoadedRecording = {
      version: 1,
      format: "twee",
      presentation: { kind: "terminal", initialCols: 80, initialRows: 24 },
      source: "delayed.twee",
      files: ["manifest.json", "events.jsonl"],
      metadata: { fileCount: 2, eventCount: 1 },
      manifest: { version: 1, command: ["echo", "late"], cols: 80, rows: 24 },
      terminalEvents: [{ id: "late", type: "output", time: 10_000, bytes: new Uint8Array() }],
      timeline: {
        startTime: 0,
        endTime: 10_000,
        duration: 10_000,
        events: [{ id: "late", type: "output", time: 10_000, bytes: new Uint8Array() }],
      },
    };
    frame = undefined;
    render(<RecordPlayer recording={delayedTwee} timeline="hidden" inspector="hidden" />);
    fireEvent.click(screen.getByRole("button", { name: "Play recording" }));
    expect(frame).toBeDefined();
    act(() => frame?.(16));
    expect(screen.getByRole("slider", { name: "Playback position" })).toHaveValue("8016");
  });
});
