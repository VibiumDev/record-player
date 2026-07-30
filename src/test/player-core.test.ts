import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import JSZip from "jszip";
import { loadRecording, parseRecording, PlayerError } from "../packages/player-core";

// Vibium/Playwright traces split each call into before/input/after lines that
// share a callId; only the "before" line carries a start time and only the
// "after" line carries an end time.
async function callLifecycleZip(): Promise<Uint8Array> {
  const lines = [
    { type: "context-options", options: {} },
    {
      type: "before",
      callId: "call@1",
      class: "Page",
      method: "vibium:page.navigate",
      title: "Page.navigate",
      startTime: 1781638347232,
      wallTime: 1781638347232,
    },
    { type: "input", callId: "call@1" },
    { type: "after", callId: "call@1", endTime: 1781638347298 },
    {
      type: "before",
      callId: "call@2",
      class: "Page",
      method: "vibium:page.click",
      title: "Page.click",
      startTime: 1781638351000,
      wallTime: 1781638351000,
    },
    { type: "after", callId: "call@2", endTime: 1781638351500 },
    { type: "screencast-frame", sha1: "abc.jpeg", timestamp: 1781638352000, width: 100, height: 50 },
  ];
  const zip = new JSZip();
  zip.file("0-trace.trace", lines.map((line) => JSON.stringify(line)).join("\n"));
  return zip.generateAsync({ type: "uint8array" });
}

describe("player-core", () => {
  it("merges call lifecycles (before/input/after) into single actions", async () => {
    const recording = await parseRecording(await callLifecycleZip());

    const actions = recording.timeline.events.filter((event) => event.kind === "action");
    expect(actions.map((action) => action.id)).toEqual(["call@1", "call@2"]);
    expect(actions[0].time).toBe(0);
    expect(actions[0].endTime).toBe(66);
    expect(actions[0].duration).toBe(66);
  });

  it("keeps the timeline at recording-span scale for call-lifecycle traces", async () => {
    const recording = await parseRecording(await callLifecycleZip());

    expect(recording.timeline.duration).toBe(1781638352000 - 1781638347232);
  });

  it("parses a real public demo zip into a normalized timeline", async () => {
    const data = await readFile(resolve(process.cwd(), "public/vibium-demo-record.zip"));
    const recording = await parseRecording(data, { source: "fixture" });

    expect(recording.version).toBe(1);
    expect(recording.source).toBe("fixture");
    expect(recording.files.length).toBeGreaterThan(0);
    expect(recording.metadata.traceEventCount).toBeGreaterThan(0);
    expect(recording.timeline.events.length).toBeGreaterThan(0);
    expect(recording.timeline.duration).toBeGreaterThan(1_000);
    expect(recording.timeline.duration).toBeLessThan(60_000);
    expect(recording.timeline.events[0]).toHaveProperty("kind");
  });

  it("loads URL strings with injected fetch, same-origin credentials, and signal", async () => {
    const data = await readFile(resolve(process.cwd(), "public/vibium-demo-record.zip"));
    const signal = new AbortController().signal;
    const fetchMock = vi.fn(async () => new Response(data, { status: 200, statusText: "OK" }));

    const recording = await loadRecording("https://example.test/record.zip", { fetch: fetchMock, signal });

    expect(recording.source).toBe("https://example.test/record.zip");
    expect(fetchMock).toHaveBeenCalledWith("https://example.test/record.zip", {
      credentials: "same-origin",
      signal,
    });
  });

  it("surfaces invalid zip data as a PlayerError", async () => {
    await expect(parseRecording(new Uint8Array([1, 2, 3, 4]))).rejects.toMatchObject({
      name: "PlayerError",
      code: "ZIP_ERROR",
    });
  });

  it("keeps player-core free of React imports", async () => {
    const source = await readFile(resolve(process.cwd(), "src/packages/player-core/index.ts"), "utf8");
    expect(source).not.toMatch(/from ["']react["']/);
    expect(source).not.toMatch(/react-dom/);
  });

  it("reports non-ok fetches with status", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 404, statusText: "Not Found" }));

    await expect(loadRecording("https://example.test/missing.zip", { fetch: fetchMock })).rejects.toBeInstanceOf(PlayerError);
    await expect(loadRecording("https://example.test/missing.zip", { fetch: fetchMock })).rejects.toMatchObject({
      code: "HTTP_ERROR",
      status: 404,
    });
  });
});
