import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecordPlayer } from "../packages/player-react";
import type { LoadedRecording } from "../packages/player-core";

function recording(): LoadedRecording {
  return {
    version: 1,
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
});
