import JSZip from "jszip";

export type RecordingEventKind = "action" | "console" | "network" | "screenshot" | "group" | "raw";

export interface RecordingEvent {
  id: string;
  kind: RecordingEventKind;
  type?: string;
  title?: string;
  method?: string;
  time: number;
  endTime?: number;
  duration?: number;
  data: Record<string, unknown>;
}

export interface ScreenshotIndex {
  id: string;
  sha1: string;
  time: number;
  width?: number;
  height?: number;
  mimeType: string;
  dataUrl?: string;
}

export interface TimelineModel {
  startTime: number;
  endTime: number;
  duration: number;
  events: RecordingEvent[];
  screenshots: ScreenshotIndex[];
}

export interface LoadedRecording {
  version: 1;
  source?: string;
  files: string[];
  metadata: {
    fileCount: number;
    eventCount: number;
    traceEventCount: number;
    networkEventCount: number;
    contextOptions?: unknown;
  };
  timeline: TimelineModel;
  raw: {
    traceEvents: unknown[];
    networkEvents: unknown[];
  };
}

export type PlayerErrorCode = "INVALID_INPUT" | "FETCH_ERROR" | "HTTP_ERROR" | "ZIP_ERROR" | "PARSE_ERROR";

export class PlayerError extends Error {
  readonly code: PlayerErrorCode;
  readonly cause?: unknown;
  readonly status?: number;

  constructor(code: PlayerErrorCode, message: string, options: { cause?: unknown; status?: number } = {}) {
    super(message);
    this.name = "PlayerError";
    this.code = code;
    this.cause = options.cause;
    this.status = options.status;
  }
}

export interface ParseRecordingOptions {
  source?: string;
  includeResourceDataUrls?: boolean;
}

export interface LoadRecordingOptions extends ParseRecordingOptions {
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  credentials?: RequestCredentials;
}

type ZipFile = JSZip.JSZipObject;

function parseNDJSON(text: string): unknown[] {
  const results: unknown[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (!line.trim()) continue;
    try {
      results.push(JSON.parse(line));
    } catch (cause) {
      throw new PlayerError("PARSE_ERROR", `Invalid NDJSON on line ${index + 1}`, { cause });
    }
  }
  return results;
}

function parseMaybeJSON(text: string): unknown[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      // Playwright/Vibium .trace and .network files are usually NDJSON, which
      // also starts with "{". Fall through to line-oriented parsing.
    }
  }
  return parseNDJSON(text);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function numberFrom(...values: unknown[]): number | undefined {
  for (const value of values) {
    // Skip empty values: Number(null), Number(""), and Number("  ") all coerce
    // to 0, which would otherwise masquerade as a real timeline time of 0.
    if (value == null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function eventTitle(event: Record<string, unknown>): string | undefined {
  const cls = typeof event.class === "string" ? event.class : "";
  const method = typeof event.method === "string" ? event.method : undefined;
  if (typeof event.title === "string") return event.title;
  if (cls && method) return `${cls}.${method}`;
  return method;
}

function screenshotMime(sha1: string): string {
  const lower = sha1.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function harMonotonicTimeToMs(value: unknown): number | undefined {
  const time = numberFrom(value);
  if (time == null) return undefined;
  return time >= 1e9 && time < 1e12 ? time * 1000 : time;
}

function isTimelineEvent(raw: unknown): boolean {
  const evt = asRecord(raw);
  // Context options are metadata for the recording context. They often carry
  // absolute wall-clock values that must not be mixed into the relative
  // playback timeline.
  if (evt.type === "context-options") return false;
  return true;
}

function normalizeEvent(raw: unknown, index: number): RecordingEvent {
  const evt = asRecord(raw);
  const type = typeof evt.type === "string" ? evt.type : undefined;
  const method = typeof evt.method === "string" ? evt.method : undefined;
  const params = asRecord(evt.params);
  const snapshot = asRecord(evt.snapshot);
  const request = asRecord(snapshot.request);
  const response = asRecord(snapshot.response);

  let kind: RecordingEventKind = "raw";
  if (type === "before" || type === "after" || type === "input") kind = "action";
  if (type === "event" && method === "log.entryAdded") kind = "console";
  if (type === "screencast-frame") kind = "screenshot";
  if (method?.startsWith("network.") || evt.snapshot) kind = "network";
  if (type === "before" && evt.class === "Tracing") kind = "group";

  const time = numberFrom(
    evt.startTime,
    evt.time,
    evt.timestamp,
    evt.wallTime,
    params.timestamp,
    harMonotonicTimeToMs(snapshot._monotonicTime),
    snapshot.startedDateTime ? Date.parse(String(snapshot.startedDateTime)) : undefined,
  ) ?? 0;
  const endTime = numberFrom(evt.endTime, snapshot.time != null ? time + Number(snapshot.time) : undefined);
  const title = eventTitle(evt) || (request.url as string | undefined) || (response.url as string | undefined);

  return {
    id: String(evt.callId ?? evt.id ?? `${kind}-${index}`),
    kind,
    type,
    title,
    method,
    time,
    endTime,
    duration: endTime != null ? Math.max(0, endTime - time) : undefined,
    data: evt,
  };
}

function extractScreenshotRefs(events: unknown[], resources: Map<string, { mimeType: string; dataUrl?: string }>): ScreenshotIndex[] {
  const screenshots: ScreenshotIndex[] = [];
  events.forEach((raw, index) => {
    const evt = asRecord(raw);
    if (evt.type !== "screencast-frame" || typeof evt.sha1 !== "string") return;
    const resource = resources.get(evt.sha1);
    screenshots.push({
      id: `screenshot-${index}`,
      sha1: evt.sha1,
      time: numberFrom(evt.timestamp, evt.time) ?? 0,
      width: numberFrom(evt.width),
      height: numberFrom(evt.height),
      mimeType: resource?.mimeType ?? screenshotMime(evt.sha1),
      dataUrl: resource?.dataUrl,
    });
  });
  return screenshots.sort((a, b) => a.time - b.time);
}

async function readEvents(files: string[], zipFiles: Record<string, ZipFile>, suffix: string): Promise<unknown[]> {
  const events: unknown[] = [];
  for (const name of files) {
    if (!name.endsWith(suffix) || zipFiles[name].dir) continue;
    const text = await zipFiles[name].async("string");
    events.push(...parseMaybeJSON(text));
  }
  return events;
}

async function readResources(
  files: string[],
  zipFiles: Record<string, ZipFile>,
  includeDataUrls: boolean,
): Promise<Map<string, { mimeType: string; dataUrl?: string }>> {
  const resources = new Map<string, { mimeType: string; dataUrl?: string }>();
  for (const name of files) {
    if (!name.startsWith("resources/") || zipFiles[name].dir) continue;
    const sha1 = name.split("/").pop();
    if (!sha1) continue;
    const mimeType = screenshotMime(sha1);
    const dataUrl = includeDataUrls ? `data:${mimeType};base64,${await zipFiles[name].async("base64")}` : undefined;
    resources.set(sha1, { mimeType, dataUrl });
  }
  return resources;
}

function buildTimeline(events: RecordingEvent[], screenshots: ScreenshotIndex[]): TimelineModel {
  const times = [
    ...events.flatMap((event) => [event.time, event.endTime]),
    ...screenshots.map((screenshot) => screenshot.time),
  ].filter((value): value is number => Number.isFinite(value));
  const startTime = times.length ? Math.min(...times) : 0;
  const endTime = times.length ? Math.max(...times) : startTime;
  const normalize = (time: number | undefined) => (Number.isFinite(time) ? Number(time) - startTime : undefined);
  return {
    startTime,
    endTime,
    duration: Math.max(0, endTime - startTime),
    events: events
      .map((event) => {
        const time = normalize(event.time) ?? 0;
        const end = normalize(event.endTime);
        return { ...event, time, endTime: end, duration: end != null ? Math.max(0, end - time) : event.duration };
      })
      .sort((a, b) => a.time - b.time),
    screenshots: screenshots.map((screenshot) => ({ ...screenshot, time: normalize(screenshot.time) ?? 0 })),
  };
}

export async function parseRecording(
  data: ArrayBuffer | Uint8Array | Blob,
  options: ParseRecordingOptions = {},
): Promise<LoadedRecording> {
  if (
    !(data instanceof ArrayBuffer) &&
    !ArrayBuffer.isView(data) &&
    !(typeof Blob !== "undefined" && data instanceof Blob)
  ) {
    throw new PlayerError("INVALID_INPUT", "parseRecording expects an ArrayBuffer, Uint8Array, or Blob");
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch (cause) {
    throw new PlayerError("ZIP_ERROR", "Unable to read recording ZIP", { cause });
  }

  try {
    const files = Object.keys(zip.files).sort();
    const traceEvents = await readEvents(files, zip.files, ".trace");
    const networkEvents = await readEvents(files, zip.files, ".network");
    const resources = await readResources(files, zip.files, options.includeResourceDataUrls ?? true);
    const allRawEvents = [...traceEvents, ...networkEvents].filter(isTimelineEvent);
    const events = allRawEvents.map(normalizeEvent);
    const screenshots = extractScreenshotRefs(traceEvents, resources);
    const contextOptions = traceEvents.map(asRecord).find((event) => event.type === "context-options");

    return {
      version: 1,
      source: options.source,
      files,
      metadata: {
        fileCount: files.length,
        eventCount: allRawEvents.length,
        traceEventCount: traceEvents.length,
        networkEventCount: networkEvents.length,
        contextOptions,
      },
      timeline: buildTimeline(events, screenshots),
      raw: { traceEvents, networkEvents },
    };
  } catch (cause) {
    if (cause instanceof PlayerError) throw cause;
    throw new PlayerError("PARSE_ERROR", "Unable to parse recording contents", { cause });
  }
}

export async function loadRecording(source: URL | string, options: LoadRecordingOptions = {}): Promise<LoadedRecording> {
  const url = source instanceof URL ? source.toString() : source;
  if (typeof url !== "string" || !url) {
    throw new PlayerError("INVALID_INPUT", "loadRecording expects a URL or URL string");
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new PlayerError("FETCH_ERROR", "No fetch implementation is available");
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      signal: options.signal,
      credentials: options.credentials ?? "same-origin",
    });
  } catch (cause) {
    throw new PlayerError("FETCH_ERROR", `Failed to fetch recording: ${url}`, { cause });
  }

  if (!response.ok) {
    throw new PlayerError("HTTP_ERROR", `Failed to fetch recording: ${response.status} ${response.statusText}`, {
      status: response.status,
    });
  }

  return parseRecording(await response.arrayBuffer(), { ...options, source: url });
}
