import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadRecording, parseRecording, PlayerError } from "../packages/player-core";

describe("player-core", () => {
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
