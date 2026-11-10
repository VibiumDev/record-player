import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RecordStudio, { __recordStudioInternals } from "../components/RecordStudio";
import { parseRecording } from "../packages/player-core";

const { browserRecordingView, videoAt, videoCorrection } = __recordStudioInternals;

// A 1×1 JPEG is enough for a screenshot the studio can show.
const JPEG = Uint8Array.from(atob("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="), (c) => c.charCodeAt(0));

// A recording of a phone as Vibium writes it on a station or a Roadie: the
// steps and screenshots in the trace, and the screen's video beside them.
async function videoZip(manifest: unknown = undefined): Promise<Uint8Array> {
  const lines = [
    { type: "context-options", options: {} },
    { type: "before", callId: "call@1", class: "Page", method: "vibium:touch.tap", title: "Page.touch.tap", pageId: "page@screen", startTime: 30, params: { x: 68, y: 570 } },
    { type: "screencast-frame", pageId: "page@screen", sha1: "page@screen-1.jpeg", width: 446, height: 972, timestamp: 30 },
    { type: "after", callId: "call@1", endTime: 162 },
    { type: "before", callId: "call@2", class: "Page", method: "vibium:page.wait", title: "Page.wait", pageId: "page@screen", startTime: 1000, params: { ms: 9000 } },
    { type: "after", callId: "call@2", endTime: 10030 },
  ];
  const zip = new JSZip();
  zip.file("trace.trace", lines.map((line) => JSON.stringify(line)).join("\n"));
  zip.file("trace.network", "");
  zip.file("resources/page@screen-1.jpeg", JPEG);
  zip.file("video/index.json", JSON.stringify(manifest ?? {
    version: 1,
    videos: [{ file: "video/screen.mp4", context: "screen", startedAt: 1794285267660, offsetMs: -120, durationMs: 10400, width: 444, height: 972, mimeType: "video/mp4" }],
  }));
  zip.file("video/screen.mp4", new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]));
  zip.file("secret.txt", "not video");
  return zip.generateAsync({ type: "uint8array" });
}

describe("a recording's video", () => {
  it("is read from the archive with its manifest", async () => {
    const recording = await parseRecording(await videoZip());
    if (recording.format !== "vibium") throw new Error("expected a Vibium recording");
    expect(recording.videos).toHaveLength(1);
    expect(recording.videos![0]).toMatchObject({ file: "video/screen.mp4", context: "screen", mimeType: "video/mp4", offsetMs: -120, durationMs: 10400, width: 444, height: 972 });
    expect(Array.from(recording.videos![0].data!)).toEqual([0, 0, 0, 24, 102, 116, 121, 112]);
  });

  it("is absent without a manifest this player knows", async () => {
    const zip = new JSZip();
    zip.file("trace.trace", JSON.stringify({ type: "before", callId: "call@1", method: "vibium:page.navigate", startTime: 1 }));
    const plain = await parseRecording(await zip.generateAsync({ type: "uint8array" }));
    expect(plain.format === "vibium" && plain.videos).toBeFalsy();

    const newer = await parseRecording(await videoZip({ version: 2, videos: [{ file: "video/screen.mp4" }] }));
    expect(newer.format === "vibium" && newer.videos).toBeFalsy();
    expect(newer.timeline.screenshots).toHaveLength(1);
  });

  it("only reads files under video/, and skips a video kept on a remote host", async () => {
    const recording = await parseRecording(await videoZip({
      version: 1,
      videos: [
        { file: "secret.txt", context: "screen", offsetMs: 0 },
        { context: "screen", remotePath: "/tmp/elsewhere.webm", offsetMs: 0 },
        { file: "video/page.webm", context: "ABC", offsetMs: 412 },
      ],
    }));
    if (recording.format !== "vibium") throw new Error("expected a Vibium recording");
    expect(recording.videos!.map((video) => [video.file, video.mimeType, video.data])).toEqual([
      ["secret.txt", "video/webm", undefined],
      ["video/page.webm", "video/webm", undefined],
    ]);
    expect(browserRecordingView(recording).videos).toBeNull();
  });
});

describe("placing a video on the player's timeline", () => {
  it("starts it where it began, which may be before the first event", async () => {
    const view = browserRecordingView(await parseRecording(await videoZip()));
    // The first event is at 30 ms of recording time, so that is the timeline's zero.
    expect(view.timelineStart).toBe(30);
    expect(view.videos).toHaveLength(1);
    expect(view.videos[0]).toMatchObject({ file: "video/screen.mp4", pageId: "page@screen", startTime: -150, duration: 10400 });
    expect(view.videos[0].frame).toEqual({ pageId: "page@screen", width: 444, height: 972 });
  });

  it("shows the moment under the playhead", () => {
    const video = { file: "v", pageId: "page@screen", startTime: -150, duration: 10400 };
    expect(videoAt([video], 0, "page@screen")).toEqual({ video, seconds: 0.15 });
    expect(videoAt([video], 5000, "page@screen")).toEqual({ video, seconds: 5.15 });
    // No page is selected in a recording that names none.
    expect(videoAt([video], 5000, null)?.seconds).toBe(5.15);
  });

  it("holds the first or last frame for a playhead just outside the video", () => {
    const late = { file: "v", startTime: 400, duration: 2000 };
    expect(videoAt([late], 0, null)).toEqual({ video: late, seconds: 0 });
    expect(videoAt([late], 2900, null)).toEqual({ video: late, seconds: 2 });
  });

  it("leaves the screenshots in place where the video does not reach", () => {
    const video = { file: "v", pageId: "page@a", startTime: 5000, duration: 2000 };
    // Long before it starts, and long after a video that ended early.
    expect(videoAt([video], 1000, "page@a")).toBeNull();
    expect(videoAt([video], 9000, "page@a")).toBeNull();
    // The video filmed another page.
    expect(videoAt([video], 6000, "page@b")).toBeNull();
    expect(videoAt(null, 0, null)).toBeNull();
    // A video whose length the recording does not give runs to the end.
    expect(videoAt([{ file: "w", startTime: 0 }], 90_000, null)?.seconds).toBe(90);
  });

  it("corrects a playing video that strays from the playhead", () => {
    expect(videoCorrection(0.01, 1)).toEqual({ seek: false, rate: 1 });
    // A little ahead it slows down; a little behind it speeds up.
    expect(videoCorrection(0.1, 1)).toEqual({ seek: false, rate: 0.9 });
    expect(videoCorrection(-0.1, 2)).toEqual({ seek: false, rate: 2.2 });
    // Far off, it jumps. At a higher speed far is further.
    expect(videoCorrection(-0.5, 1)).toEqual({ seek: true, rate: 1 });
    expect(videoCorrection(-0.5, 4).seek).toBe(false);
  });
});

describe("the studio's preview", () => {
  let play: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.history.pushState({}, "", "/?i=h&t=h&c=v");
    localStorage.clear();
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
    });
    // jsdom has neither blob addresses nor media playback.
    URL.createObjectURL = vi.fn(() => "blob:recording-video");
    URL.revokeObjectURL = vi.fn();
    play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  async function open(file: Uint8Array) {
    Object.defineProperty(file, "name", { value: "record.zip" });
    const view = render(<RecordStudio initialFile={file} hideGlobalChrome />);
    await screen.findByRole("button", { name: "Skip idle" });
    return view;
  }

  it("shows the video in place of the screenshot, at the playhead", async () => {
    const { container } = await open(await videoZip());
    const video = await waitFor(() => {
      const el = container.querySelector("video");
      if (!el) throw new Error("no video yet");
      return el;
    });
    expect(video.getAttribute("src")).toBe("blob:recording-video");
    expect(video.muted).toBe(true);
    expect(video.style.display).toBe("block");
    expect(screen.queryByAltText("trace screenshot")).not.toBeInTheDocument();

    // Paused at the start: the video began 150 ms before the first event.
    act(() => {
      fireEvent.loadedMetadata(video);
    });
    expect(video.currentTime).toBeCloseTo(0.15, 3);
    expect(play).not.toHaveBeenCalled();
  });

  it("goes back to the screenshots when the browser cannot play the video", async () => {
    const { container } = await open(await videoZip());
    const video = await waitFor(() => {
      const el = container.querySelector("video");
      if (!el) throw new Error("no video yet");
      return el;
    });
    act(() => {
      fireEvent.error(video);
    });
    expect(container.querySelector("video")).toBeNull();
    expect(await screen.findByAltText("trace screenshot")).toBeInTheDocument();
  });

  it("shows screenshots alone for a recording without video", async () => {
    const zip = await JSZip.loadAsync(await videoZip());
    zip.remove("video/index.json");
    zip.remove("video/screen.mp4");
    const { container } = await open(await zip.generateAsync({ type: "uint8array" }));
    expect(await screen.findByAltText("trace screenshot")).toBeInTheDocument();
    expect(container.querySelector("video")).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
