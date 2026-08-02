import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import JSZip from "jszip";
import {
  detectRecordingFormat,
  loadRecording,
  parseRecording,
  PlayerError,
  TWEE_PARSER_LIMITS,
} from "../packages/player-core";

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

const validTweeManifest = {
  version: 1,
  command: ["bash", "-l"],
  env: { TERM: "xterm-256color", LANG: "en_US.UTF-8" },
  cols: 80,
  rows: 24,
  pid: 4242,
  host: { os: "linux", arch: "amd64", hostname: "devbox" },
  started_at: "2026-07-31T12:00:00.000Z",
  stopped_at: "2026-07-31T12:00:02.000Z",
};

async function tweeZip(options: {
  manifest?: unknown;
  events?: Array<unknown> | string | Uint8Array;
  includeManifest?: boolean;
  includeEvents?: boolean;
} = {}): Promise<Uint8Array> {
  const zip = new JSZip();
  if (options.includeManifest !== false) {
    zip.file("manifest.json", JSON.stringify(options.manifest ?? validTweeManifest));
  }
  if (options.includeEvents !== false) {
    const events = options.events ?? [];
    zip.file(
      "events.jsonl",
      typeof events === "string" || events instanceof Uint8Array
        ? events
        : events.map((event) => JSON.stringify(event)).join("\n"),
    );
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

function endOfCentralDirectory(data: Uint8Array): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let index = data.byteLength - 22; index >= 0; index--) {
    if (view.getUint32(index, true) === 0x06054b50) return index;
  }
  throw new Error("test ZIP has no end-of-central-directory record");
}

function centralEntry(data: Uint8Array, wantedName: string): { offset: number; length: number } {
  const eocd = endOfCentralDirectory(data);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const centralSize = view.getUint32(eocd + 12, true);
  let offset = eocd - centralSize;
  while (offset < eocd) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("invalid test ZIP central directory");
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const length = 46 + nameLength + extraLength + commentLength;
    const name = new TextDecoder().decode(data.subarray(offset + 46, offset + 46 + nameLength));
    if (name === wantedName) return { offset, length };
    offset += length;
  }
  throw new Error(`test ZIP has no ${wantedName} entry`);
}

function duplicateEntry(data: Uint8Array, name: string): Uint8Array {
  const eocd = endOfCentralDirectory(data);
  const entry = centralEntry(data, name);
  const duplicate = data.subarray(entry.offset, entry.offset + entry.length);
  const result = new Uint8Array(data.byteLength + duplicate.byteLength);
  result.set(data.subarray(0, eocd));
  result.set(duplicate, eocd);
  result.set(data.subarray(eocd), eocd + duplicate.byteLength);
  const sourceView = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const resultView = new DataView(result.buffer);
  const resultEocd = eocd + duplicate.byteLength;
  resultView.setUint16(resultEocd + 8, sourceView.getUint16(eocd + 8, true) + 1, true);
  resultView.setUint16(resultEocd + 10, sourceView.getUint16(eocd + 10, true) + 1, true);
  resultView.setUint32(resultEocd + 12, sourceView.getUint32(eocd + 12, true) + duplicate.byteLength, true);
  return result;
}

function setDeclaredExpandedSize(data: Uint8Array, name: string, size: number): Uint8Array {
  const copy = data.slice();
  const entry = centralEntry(copy, name);
  new DataView(copy.buffer).setUint32(entry.offset + 24, size, true);
  return copy;
}

function testCrc32(bytes: Uint8Array): number {
  let value = -1;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ -1) >>> 0;
}

function rewriteWithUnicodePath(data: Uint8Array, originalName: string, rawName: string, unicodeName: string): Uint8Array {
  const copy = data.slice();
  const entry = centralEntry(copy, originalName);
  const view = new DataView(copy.buffer);
  const nameLength = view.getUint16(entry.offset + 28, true);
  const extraLength = view.getUint16(entry.offset + 30, true);
  const encoder = new TextEncoder();
  const rawBytes = encoder.encode(rawName);
  const unicodeBytes = encoder.encode(unicodeName);
  if (rawBytes.byteLength !== nameLength || unicodeBytes.byteLength !== nameLength) {
    throw new Error("test rewrite names must have the original encoded length");
  }

  view.setUint16(entry.offset + 8, view.getUint16(entry.offset + 8, true) & ~0x0800, true);
  copy.set(rawBytes, entry.offset + 46);
  let extraOffset = entry.offset + 46 + nameLength;
  const extraEnd = extraOffset + extraLength;
  let unicodeField = -1;
  while (extraOffset + 4 <= extraEnd) {
    const id = view.getUint16(extraOffset, true);
    const length = view.getUint16(extraOffset + 2, true);
    if (id === 0x7075) {
      unicodeField = extraOffset + 4;
      if (length !== nameLength + 5) throw new Error("unexpected test Unicode path length");
      break;
    }
    extraOffset += 4 + length;
  }
  if (unicodeField < 0) throw new Error("test ZIP has no Unicode path extra field");
  copy[unicodeField] = 1;
  view.setUint32(unicodeField + 1, testCrc32(rawBytes), true);
  copy.set(unicodeBytes, unicodeField + 5);

  const localOffset = view.getUint32(entry.offset + 42, true);
  view.setUint16(localOffset + 6, view.getUint16(localOffset + 6, true) & ~0x0800, true);
  copy.set(rawBytes, localOffset + 30);
  return copy;
}

function rewriteLastCentralName(data: Uint8Array, originalName: string, replacement: string): Uint8Array {
  const copy = data.slice();
  const eocd = endOfCentralDirectory(copy);
  const view = new DataView(copy.buffer);
  const centralSize = view.getUint32(eocd + 12, true);
  let offset = eocd - centralSize;
  let found = -1;
  let foundLength = 0;
  while (offset < eocd) {
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const name = new TextDecoder().decode(copy.subarray(offset + 46, offset + 46 + nameLength));
    if (name === originalName) {
      found = offset + 46;
      foundLength = nameLength;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  const replacementBytes = new TextEncoder().encode(replacement);
  if (found < 0 || replacementBytes.byteLength !== foundLength) throw new Error("invalid central-name test rewrite");
  copy.set(replacementBytes, found);
  return copy;
}

function requireTwee(recording: Awaited<ReturnType<typeof parseRecording>>) {
  if (recording.format !== "twee") throw new Error("expected a Twee recording");
  return recording;
}

function requireVibium(recording: Awaited<ReturnType<typeof parseRecording>>) {
  if (recording.format !== "vibium") throw new Error("expected a Vibium recording");
  return recording;
}

describe("player-core", () => {
  it("merges call lifecycles (before/input/after) into single actions", async () => {
    const recording = requireVibium(await parseRecording(await callLifecycleZip()));

    const actions = recording.timeline.events.filter((event) => event.kind === "action");
    expect(actions.map((action) => action.id)).toEqual(["call@1", "call@2"]);
    expect(actions[0].time).toBe(0);
    expect(actions[0].endTime).toBe(66);
    expect(actions[0].duration).toBe(66);
  });

  it("keeps the timeline at recording-span scale for call-lifecycle traces", async () => {
    const recording = requireVibium(await parseRecording(await callLifecycleZip()));

    expect(recording.timeline.duration).toBe(1781638352000 - 1781638347232);
  });

  it("parses a real public demo zip into a normalized timeline", async () => {
    const data = await readFile(resolve(process.cwd(), "public/vibium-demo-record.zip"));
    const recording = requireVibium(await parseRecording(data, { source: "fixture" }));

    expect(recording.version).toBe(1);
    expect(recording.source).toBe("fixture");
    expect(recording.files.length).toBeGreaterThan(0);
    expect(recording.metadata.traceEventCount).toBeGreaterThan(0);
    expect(recording.timeline.events.length).toBeGreaterThan(0);
    expect(recording.timeline.duration).toBeGreaterThan(1_000);
    expect(recording.timeline.duration).toBeLessThan(60_000);
    expect(recording.timeline.events[0]).toHaveProperty("kind");
  });

  it("detects formats from ZIP structure without parsing Vibium NDJSON", async () => {
    const vibium = new JSZip();
    vibium.file("trace.trace", "{malformed\n" + JSON.stringify({ type: "event", time: 1 }));

    expect(await detectRecordingFormat(await vibium.generateAsync({ type: "uint8array" }))).toBe("vibium");
    expect(await detectRecordingFormat(await tweeZip())).toBe("twee");
  });

  it("conservatively detects a reserved Twee name from either ZIP header", async () => {
    const zip = new JSZip();
    zip.file("aaaaaaaaaaaaa", "{}");
    let data = await zip.generateAsync({ type: "uint8array" });
    data = rewriteLastCentralName(data, "aaaaaaaaaaaaa", "manifest.json");

    expect(await detectRecordingFormat(data)).toBe("twee");
  });

  it("does not let a directory name in one ZIP header suppress a reserved name in the other", async () => {
    const zip = new JSZip();
    zip.file("manifest.json", "{}");
    let data = await zip.generateAsync({ type: "uint8array" });
    data = rewriteLastCentralName(data, "manifest.json", "aaaaaaaaaaaa/");

    expect(await detectRecordingFormat(data)).toBe("twee");
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

  it("rejects an oversized valid Content-Length before reading and cancels the body", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const body = new ReadableStream<Uint8Array>({ cancel });
    const fetchMock = vi.fn(async () => new Response(body, { headers: { "Content-Length": "9" } }));

    await expect(
      loadRecording("https://example.test/too-large.zip", { fetch: fetchMock, maxDownloadBytes: 8 }),
    ).rejects.toMatchObject({
      code: "LIMIT_ERROR",
      message: expect.stringContaining("8-byte limit"),
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("cancels a chunked response as soon as it crosses the download limit", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(5));
        controller.enqueue(new Uint8Array(4));
      },
      cancel,
    });
    const fetchMock = vi.fn(async () => new Response(body));

    await expect(
      loadRecording("https://example.test/chunked.zip", { fetch: fetchMock, maxDownloadBytes: 8 }),
    ).rejects.toMatchObject({ code: "LIMIT_ERROR" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("accepts a streamed recording exactly at the configured download boundary", async () => {
    const data = await callLifecycleZip();
    const split = Math.floor(data.byteLength / 2);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(data.subarray(0, split));
        controller.enqueue(data.subarray(split));
        controller.close();
      },
    });
    const fetchMock = vi.fn(async () => new Response(body, { headers: { "Content-Length": String(data.byteLength) } }));

    const recording = requireVibium(
      await loadRecording("https://example.test/exact.zip", {
        fetch: fetchMock,
        maxDownloadBytes: data.byteLength,
      }),
    );
    expect(recording.metadata.traceEventCount).toBeGreaterThan(0);
  });

  it.each([null, 0, TWEE_PARSER_LIMITS.zipBytes + 1, 1.5])(
    "rejects invalid maxDownloadBytes %s before fetching",
    async (maxDownloadBytes) => {
      const fetchMock = vi.fn();
      await expect(
        loadRecording("https://example.test/recording.zip", {
          fetch: fetchMock,
          maxDownloadBytes: maxDownloadBytes as number,
        }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("preserves unbounded Vibium URL loading unless a caller configures a download cap", async () => {
    const data = await callLifecycleZip();
    const arrayBuffer = vi.fn(async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "Content-Length": String(TWEE_PARSER_LIMITS.zipBytes + 1) }),
      body: null,
      arrayBuffer,
    }) as unknown as Response);

    const recording = requireVibium(await loadRecording("https://example.test/large-record.zip", { fetch: fetchMock }));
    expect(recording.metadata.traceEventCount).toBeGreaterThan(0);
    expect(arrayBuffer).toHaveBeenCalledOnce();
  });

  it("treats an explicitly undefined maxDownloadBytes as omitted", async () => {
    const data = await callLifecycleZip();
    const fetchMock = vi.fn(async () => new Response(data));

    const recording = requireVibium(
      await loadRecording("https://example.test/record.zip", {
        fetch: fetchMock,
        maxDownloadBytes: undefined,
      }),
    );
    expect(recording.metadata.traceEventCount).toBeGreaterThan(0);
  });

  it.each([
    ["https://example.test/session.TWEE?download=1", ""],
    ["https://example.test/session.zip", "https://cdn.example.test/session.twee"],
  ])("applies the implicit Twee cap for requested or redirected URLs", async (requestedURL, responseURL) => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }), {
      headers: { "Content-Length": String(TWEE_PARSER_LIMITS.zipBytes + 1) },
    });
    if (responseURL) Object.defineProperty(response, "url", { value: responseURL });
    const fetchMock = vi.fn(async () => response);

    await expect(loadRecording(requestedURL, { fetch: fetchMock })).rejects.toMatchObject({
      code: "LIMIT_ERROR",
      message: expect.stringContaining(`${TWEE_PARSER_LIMITS.zipBytes}-byte limit`),
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("fails closed before allocation when a bounded response has no stream", async () => {
    const arrayBuffer = vi.fn();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "Content-Length": "1" }),
      body: null,
      arrayBuffer,
    }) as unknown as Response);

    await expect(
      loadRecording("https://example.test/recording.zip", { fetch: fetchMock, maxDownloadBytes: 8 }),
    ).rejects.toMatchObject({
      code: "FETCH_ERROR",
      message: expect.stringContaining("not streamable"),
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("wraps response stream failures as fetch errors", async () => {
    const cause = new Error("network stream failed");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(cause);
      },
    });
    const fetchMock = vi.fn(async () => new Response(body));

    await expect(loadRecording("https://example.test/broken.zip", { fetch: fetchMock })).rejects.toMatchObject({
      code: "FETCH_ERROR",
      cause,
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

  it("detects and parses a valid Twee v1 archive from its ZIP contents", async () => {
    const recording = requireTwee(
      await parseRecording(
        await tweeZip({
          events: [
            { t_ms: 0, type: "output", bytes_b64: "aGk=" },
            { t_ms: 250, type: "resize", cols: 100, rows: 30 },
            { t_ms: 500, type: "input", kind: "key", key: "Enter", bytes_b64: "DQ==" },
            { t_ms: 750, type: "exit" },
          ],
        }),
        { source: "recording.zip" },
      ),
    );

    expect(recording).toMatchObject({
      version: 1,
      format: "twee",
      source: "recording.zip",
      presentation: { kind: "terminal", initialCols: 80, initialRows: 24 },
      metadata: { fileCount: 2, eventCount: 4 },
      manifest: {
        version: 1,
        command: ["bash", "-l"],
        env: { TERM: "xterm-256color", LANG: "en_US.UTF-8" },
        cols: 80,
        rows: 24,
        pid: 4242,
        host: { os: "linux", arch: "amd64", hostname: "devbox" },
        startedAt: "2026-07-31T12:00:00.000Z",
        stoppedAt: "2026-07-31T12:00:02.000Z",
      },
      timeline: { startTime: 0, endTime: 2_000, duration: 2_000 },
    });
    expect(recording.terminalEvents[0]).toMatchObject({ type: "output", time: 0 });
    expect(recording.terminalEvents[0].type === "output" && [...recording.terminalEvents[0].bytes]).toEqual([104, 105]);
    expect(recording.terminalEvents[1]).toMatchObject({ type: "resize", time: 250, cols: 100, rows: 30 });
    expect(recording.terminalEvents[2]).toMatchObject({
      type: "input",
      time: 500,
      inputKind: "key",
      key: "Enter",
    });
    expect(recording.terminalEvents[3]).toEqual({ id: "twee-3", type: "exit", time: 750, code: 0 });
    expect(recording.timeline.events).toBe(recording.terminalEvents);
    expect(recording).not.toHaveProperty("raw");
    expect(recording.timeline).not.toHaveProperty("screenshots");
  });

  it("marks Vibium recordings with screenshot-specific model data", async () => {
    const recording = await parseRecording(await callLifecycleZip());

    expect(recording).toMatchObject({ format: "vibium", presentation: { kind: "screenshot" } });
    if (recording.format !== "vibium") throw new Error("expected a Vibium recording");
    expect(recording.timeline).toHaveProperty("screenshots");
    expect(recording).not.toHaveProperty("manifest");
    expect(recording).not.toHaveProperty("terminalEvents");
  });

  it.each(["manifest.json/", "/manifest.json"])(
    "does not mistake the Vibium entry %j for the Twee manifest root",
    async (confusingName) => {
      const zip = new JSZip();
      zip.file("trace.trace", `${JSON.stringify({ type: "before", callId: "call@1", startTime: 0 })}\n`);
      zip.file(confusingName, "", { dir: confusingName.endsWith("/") });

      const recording = requireVibium(await parseRecording(await zip.generateAsync({ type: "uint8array" })));
      expect(recording.format).toBe("vibium");
    },
  );

  it("detects Twee roots encoded through validated Unicode Path extra fields", async () => {
    const zip = new JSZip();
    zip.file("aaaaaaaaaaaé", JSON.stringify(validTweeManifest));
    zip.file("aaaaaaaaaaé", "");
    let data = await zip.generateAsync({ type: "uint8array" });
    data = rewriteWithUnicodePath(data, "aaaaaaaaaaaé", "aaaaaaaaaaaaa", "manifest.json");
    data = rewriteWithUnicodePath(data, "aaaaaaaaaaé", "bbbbbbbbbbbb", "events.jsonl");

    const recording = requireTwee(await parseRecording(data));
    expect(recording.files).toEqual(["events.jsonl", "manifest.json"]);
  });

  it("rejects a Twee archive with no manifest", async () => {
    await expect(tweeZip({ includeManifest: false, events: [] }).then((data) => parseRecording(data))).rejects.toMatchObject({
      code: "PARSE_ERROR",
      message: expect.stringContaining("missing manifest.json"),
    });
  });

  it("rejects a Twee archive with no event file", async () => {
    await expect(tweeZip({ includeEvents: false }).then((data) => parseRecording(data))).rejects.toMatchObject({
      code: "PARSE_ERROR",
      message: expect.stringContaining("missing events.jsonl"),
    });
  });

  it("rejects unsupported Twee versions", async () => {
    await expect(
      tweeZip({ manifest: { ...validTweeManifest, version: 2 } }).then((data) => parseRecording(data)),
    ).rejects.toMatchObject({
      code: "PARSE_ERROR",
      message: expect.stringContaining("expected version 1"),
    });
  });

  it("reports the line containing malformed event JSON", async () => {
    await expect(
      tweeZip({ events: '{"t_ms":0,"type":"output"}\n{not json' }).then((data) => parseRecording(data)),
    ).rejects.toMatchObject({
      code: "PARSE_ERROR",
      message: expect.stringContaining("line 2"),
    });
  });

  it("rejects invalid UTF-8 in the event stream", async () => {
    await expect(tweeZip({ events: new Uint8Array([0xff]) }).then((data) => parseRecording(data))).rejects.toMatchObject({
      code: "PARSE_ERROR",
      message: expect.stringContaining("UTF-8"),
    });
  });

  it.each(["a Gk=", "aGk", "aGm="])("strictly rejects invalid or non-canonical Base64 %j", async (bytes_b64) => {
    await expect(
      tweeZip({ events: [{ t_ms: 0, type: "output", bytes_b64 }] }).then((data) => parseRecording(data)),
    ).rejects.toMatchObject({ code: "PARSE_ERROR", message: expect.stringContaining("Base64") });
  });

  it.each([
    [0, 24],
    [80, -1],
    [TWEE_PARSER_LIMITS.terminalColumns + 1, 24],
  ])("rejects an invalid initial terminal size (%s x %s)", async (cols, rows) => {
    await expect(
      tweeZip({ manifest: { ...validTweeManifest, cols, rows } }).then((data) => parseRecording(data)),
    ).rejects.toBeInstanceOf(PlayerError);
  });

  it("rejects an invalid resize event", async () => {
    await expect(
      tweeZip({ events: [{ t_ms: 10, type: "resize", cols: 80, rows: 0 }] }).then((data) => parseRecording(data)),
    ).rejects.toMatchObject({ code: "PARSE_ERROR", message: expect.stringContaining("rows") });
  });

  it("keeps file order for events with equal times", async () => {
    const recording = requireTwee(
      await parseRecording(
        await tweeZip({
          events: [
            { t_ms: 50, type: "output", bytes_b64: "QQ==" },
            { t_ms: 50, type: "input", kind: "type", bytes_b64: "Qg==" },
            { t_ms: 50, type: "output", bytes_b64: "Qw==" },
          ],
        }),
      ),
    );

    expect(recording.terminalEvents.map((event) => event.type)).toEqual(["output", "input", "output"]);
    expect(recording.terminalEvents.map((event) => event.id)).toEqual(["twee-0", "twee-1", "twee-2"]);
    expect(recording.terminalEvents.map((event) => event.time)).toEqual([50, 50, 50]);
  });

  it("accepts an empty Twee event stream", async () => {
    const recording = requireTwee(
      await parseRecording(
        await tweeZip({
          manifest: { ...validTweeManifest, started_at: undefined, stopped_at: undefined },
          events: "\n\r\n",
        }),
      ),
    );

    expect(recording.terminalEvents).toEqual([]);
    expect(recording.timeline).toMatchObject({ startTime: 0, endTime: 0, duration: 0, events: [] });
  });

  it("rejects a file whose declared expanded size exceeds its limit before reading it", async () => {
    const oversizedManifest = {
      ...validTweeManifest,
      padding: "x".repeat(TWEE_PARSER_LIMITS.manifestBytes),
    };

    await expect(tweeZip({ manifest: oversizedManifest }).then((data) => parseRecording(data))).rejects.toMatchObject({
      code: "LIMIT_ERROR",
      message: expect.stringContaining("manifest.json"),
    });
  });

  it("does not impose Twee expanded-entry limits on Vibium resources", async () => {
    const zip = new JSZip();
    zip.file("trace.trace", `${JSON.stringify({ type: "before", callId: "call@1", startTime: 0 })}\n`);
    zip.file("resources/large.jpeg", "not actually expanded in this test");
    const data = await zip.generateAsync({ type: "uint8array" });
    const declaredLargeResource = setDeclaredExpandedSize(
      data,
      "resources/large.jpeg",
      TWEE_PARSER_LIMITS.expandedFileBytes + 1,
    );

    const recording = requireVibium(
      await parseRecording(declaredLargeResource, { includeResourceDataUrls: false }),
    );
    expect(recording.files).toContain("resources/large.jpeg");
  });

  it("rejects duplicate Twee root entries during ZIP preflight", async () => {
    const data = duplicateEntry(await tweeZip(), "manifest.json");

    await expect(parseRecording(data)).rejects.toMatchObject({
      code: "PARSE_ERROR",
      message: expect.stringContaining("duplicate"),
    });
  });

  it("uses local-header names when detecting disguised duplicate Twee roots", async () => {
    let data = duplicateEntry(await tweeZip(), "manifest.json");
    data = rewriteLastCentralName(data, "manifest.json", "aaaaaaaaaaaaa");

    await expect(parseRecording(data)).rejects.toMatchObject({
      code: "PARSE_ERROR",
      message: expect.stringContaining("duplicate"),
    });
  });

  it("rejects a Twee ZIP whose actual entry count exceeds the file limit before JSZip loads it", async () => {
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify(validTweeManifest));
    zip.file("events.jsonl", "");
    for (let index = 0; index < TWEE_PARSER_LIMITS.files; index++) zip.file(`extra-${index}`, "");
    const data = await zip.generateAsync({ type: "uint8array" });

    await expect(parseRecording(data)).rejects.toMatchObject({
      code: "LIMIT_ERROR",
      message: expect.stringContaining("file limit"),
    });
  }, 15_000);

  it("rejects an event stream above the event-count limit", async () => {
    const event = '{"t_ms":0,"type":"output"}';
    const events = Array.from({ length: TWEE_PARSER_LIMITS.events + 1 }, () => event).join("\n");

    await expect(tweeZip({ events }).then((data) => parseRecording(data))).rejects.toMatchObject({
      code: "LIMIT_ERROR",
      message: expect.stringContaining("event limit"),
    });
  });

  it("rejects an event payload above the decoded payload limit", async () => {
    const oversizedBase64 = "A".repeat(Math.ceil((TWEE_PARSER_LIMITS.eventPayloadBytes + 1) / 3) * 4);

    await expect(
      tweeZip({ events: [{ t_ms: 0, type: "output", bytes_b64: oversizedBase64 }] }).then((data) => parseRecording(data)),
    ).rejects.toMatchObject({
      code: "LIMIT_ERROR",
      message: expect.stringContaining("event payload limit"),
    });
  });
});
