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

export interface TimelineEvent {
  id: string;
  time: number;
}

export interface RecordingTimeline<TEvent extends TimelineEvent = RecordingEvent> {
  startTime: number;
  endTime: number;
  duration: number;
  events: TEvent[];
}

export interface RecordingMetadata {
  fileCount: number;
  eventCount: number;
}

export interface RecordingBase<
  TTimeline extends RecordingTimeline<TimelineEvent> = RecordingTimeline,
> {
  version: 1;
  source?: string;
  files: string[];
  metadata: RecordingMetadata;
  timeline: TTimeline;
}

export interface ScreenshotPresentation {
  kind: "screenshot";
}

export interface TerminalPresentation {
  kind: "terminal";
  initialCols: number;
  initialRows: number;
}

export interface VibiumRecording extends RecordingBase<TimelineModel> {
  format: "vibium";
  presentation: ScreenshotPresentation;
  metadata: RecordingMetadata & {
    fileCount: number;
    eventCount: number;
    traceEventCount: number;
    networkEventCount: number;
    contextOptions?: unknown;
  };
  raw: {
    traceEvents: unknown[];
    networkEvents: unknown[];
  };
}

export interface TweeHostInfo {
  os: string;
  arch: string;
  hostname: string;
}

export interface TweeManifest {
  version: 1;
  command: string[];
  cols: number;
  rows: number;
  env?: Record<string, string>;
  pid?: number;
  host?: TweeHostInfo;
  startedAt?: string;
  stoppedAt?: string;
}

export interface TweeMouseInput {
  gesture: string;
  x?: number;
  y?: number;
  fromX?: number;
  fromY?: number;
  toX?: number;
  toY?: number;
  button?: string;
  modifiers: string[];
  direction?: string;
  ticks?: number;
}

interface TweeEventBase {
  id: string;
  time: number;
}

export interface TweeOutputEvent extends TweeEventBase {
  type: "output";
  bytes: Uint8Array;
}

export interface TweeInputEvent extends TweeEventBase {
  type: "input";
  bytes: Uint8Array;
  inputKind?: string;
  key?: string;
  mouse?: TweeMouseInput;
}

export interface TweeResizeEvent extends TweeEventBase {
  type: "resize";
  cols: number;
  rows: number;
}

export interface TweeExitEvent extends TweeEventBase {
  type: "exit";
  code: number;
}

export type TweeEvent = TweeOutputEvent | TweeInputEvent | TweeResizeEvent | TweeExitEvent;

export interface TweeRecording extends RecordingBase<RecordingTimeline<TweeEvent>> {
  format: "twee";
  presentation: TerminalPresentation;
  manifest: TweeManifest;
  terminalEvents: TweeEvent[];
}

export type RecordingDocument = VibiumRecording | TweeRecording;
export type RecordingFormat = RecordingDocument["format"];

// Keep the original public name while allowing callers to discriminate the
// format-specific recording shapes through `format`.
export type LoadedRecording = RecordingDocument;

export const TWEE_PARSER_LIMITS = Object.freeze({
  zipBytes: 64 * 1024 * 1024,
  files: 10_000,
  expandedFileBytes: 32 * 1024 * 1024,
  manifestBytes: 64 * 1024,
  events: 100_000,
  eventPayloadBytes: 8 * 1024 * 1024,
  terminalColumns: 1_000,
  terminalRows: 1_000,
  terminalCells: 1_000_000,
});

export type PlayerErrorCode =
  | "INVALID_INPUT"
  | "FETCH_ERROR"
  | "HTTP_ERROR"
  | "ZIP_ERROR"
  | "PARSE_ERROR"
  | "LIMIT_ERROR";

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
  maxDownloadBytes?: number;
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

function requireRecord(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PlayerError("PARSE_ERROR", `${context} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function inputByteLength(data: ArrayBuffer | ArrayBufferView | Blob): number {
  if (typeof Blob !== "undefined" && data instanceof Blob) return data.size;
  return (data as ArrayBuffer | ArrayBufferView).byteLength;
}

interface ZipPreflightResult {
  isTwee: boolean;
  entryCount: number;
}

interface InputRangeReader {
  length: number;
  read(start: number, length: number): Promise<Uint8Array>;
}

function inputRangeReader(data: ArrayBuffer | ArrayBufferView | Blob): InputRangeReader {
  const length = inputByteLength(data);
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    let cacheStart = -1;
    let cache = new Uint8Array();
    return {
      length,
      async read(start, requestedLength) {
        if (start < 0 || requestedLength < 0 || start + requestedLength > length) {
          throw new PlayerError("ZIP_ERROR", "Recording ZIP contains an invalid directory offset");
        }
        if (start >= cacheStart && start + requestedLength <= cacheStart + cache.byteLength) {
          return cache.subarray(start - cacheStart, start - cacheStart + requestedLength);
        }
        const readLength = Math.min(length - start, Math.max(requestedLength, 64 * 1024));
        cacheStart = start;
        cache = new Uint8Array(await data.slice(start, start + readLength).arrayBuffer());
        return cache.subarray(0, requestedLength);
      },
    };
  }

  const binaryData = data as ArrayBuffer | ArrayBufferView;
  const bytes = binaryData instanceof ArrayBuffer
    ? new Uint8Array(binaryData)
    : new Uint8Array(binaryData.buffer, binaryData.byteOffset, binaryData.byteLength);
  return {
    length,
    async read(start, requestedLength) {
      if (start < 0 || requestedLength < 0 || start + requestedLength > length) {
        throw new PlayerError("ZIP_ERROR", "Recording ZIP contains an invalid directory offset");
      }
      return bytes.subarray(start, start + requestedLength);
    },
  };
}

function uint64(view: DataView, offset: number): number {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new PlayerError("ZIP_ERROR", "Recording ZIP uses an unsupported 64-bit directory size");
  }
  return Number(value);
}

function resolveZipPath(name: string): string {
  const parts: string[] = [];
  const split = name.split("/");
  for (let index = 0; index < split.length; index++) {
    const part = split[index];
    if (part === "." || (part === "" && index !== 0 && index !== split.length - 1)) continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function crc32(bytes: Uint8Array): number {
  let value = -1;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ -1) >>> 0;
}

function zipExtraFields(bytes: Uint8Array): Map<number, Uint8Array> {
  const fields = new Map<number, Uint8Array>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset + 4 <= bytes.byteLength) {
    const id = view.getUint16(offset, true);
    const length = view.getUint16(offset + 2, true);
    offset += 4;
    if (offset + length > bytes.byteLength) break;
    fields.set(id, bytes.subarray(offset, offset + length));
    offset += length;
  }
  return fields;
}

function unicodeZipName(rawName: Uint8Array, field: Uint8Array | undefined): string | undefined {
  if (!field || field.byteLength < 5 || field[0] !== 1) return undefined;
  const view = new DataView(field.buffer, field.byteOffset, field.byteLength);
  if (view.getUint32(1, true) !== crc32(rawName)) return undefined;
  return new TextDecoder("utf-8").decode(field.subarray(5));
}

async function preflightZip(data: ArrayBuffer | ArrayBufferView | Blob): Promise<ZipPreflightResult> {
  const reader = inputRangeReader(data);
  if (reader.length < 22) throw new PlayerError("ZIP_ERROR", "Unable to read recording ZIP");
  const tailLength = Math.min(reader.length, 65_557);
  const tailStart = reader.length - tailLength;
  const tail = await reader.read(tailStart, tailLength);
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocdIndex = -1;
  for (let index = tail.byteLength - 22; index >= 0; index--) {
    if (tailView.getUint32(index, true) !== 0x06054b50) continue;
    const commentLength = tailView.getUint16(index + 20, true);
    if (index + 22 + commentLength === tail.byteLength) {
      eocdIndex = index;
      break;
    }
  }
  if (eocdIndex < 0) throw new PlayerError("ZIP_ERROR", "Unable to find the recording ZIP directory");

  const eocdOffset = tailStart + eocdIndex;
  if (tailView.getUint16(eocdIndex + 4, true) !== 0 || tailView.getUint16(eocdIndex + 6, true) !== 0) {
    throw new PlayerError("ZIP_ERROR", "Multi-disk recording ZIPs are not supported");
  }
  let expectedEntries = tailView.getUint16(eocdIndex + 10, true);
  let centralSize = tailView.getUint32(eocdIndex + 12, true);
  let declaredCentralOffset = tailView.getUint32(eocdIndex + 16, true);
  let centralEnd = eocdOffset;

  if (expectedEntries === 0xffff || centralSize === 0xffffffff) {
    if (eocdOffset < 20) throw new PlayerError("ZIP_ERROR", "Recording ZIP has an invalid ZIP64 locator");
    const locator = await reader.read(eocdOffset - 20, 20);
    const locatorView = new DataView(locator.buffer, locator.byteOffset, locator.byteLength);
    if (locatorView.getUint32(0, true) !== 0x07064b50 || locatorView.getUint32(4, true) !== 0) {
      throw new PlayerError("ZIP_ERROR", "Recording ZIP has an invalid ZIP64 locator");
    }
    const zip64Offset = uint64(locatorView, 8);
    const zip64 = await reader.read(zip64Offset, 56);
    const zip64View = new DataView(zip64.buffer, zip64.byteOffset, zip64.byteLength);
    if (zip64View.getUint32(0, true) !== 0x06064b50) {
      throw new PlayerError("ZIP_ERROR", "Recording ZIP has an invalid ZIP64 directory");
    }
    expectedEntries = uint64(zip64View, 32);
    centralSize = uint64(zip64View, 40);
    declaredCentralOffset = uint64(zip64View, 48);
    centralEnd = zip64Offset;
  }

  const centralStart = centralEnd - centralSize;
  if (centralStart < 0 || centralEnd > reader.length) {
    throw new PlayerError("ZIP_ERROR", "Recording ZIP contains an invalid central directory");
  }
  let offsetAdjustment = centralStart - declaredCentralOffset;
  if (declaredCentralOffset >= 0 && declaredCentralOffset + 4 <= reader.length) {
    const declaredHeader = await reader.read(declaredCentralOffset, 4);
    const declaredView = new DataView(declaredHeader.buffer, declaredHeader.byteOffset, declaredHeader.byteLength);
    if (declaredView.getUint32(0, true) === 0x02014b50) offsetAdjustment = 0;
  }

  let cursor = centralStart;
  let entryCount = 0;
  let manifestCount = 0;
  let eventsCount = 0;
  let firstOversizedEntry: string | undefined;
  while (cursor < centralEnd) {
    const header = await reader.read(cursor, 46);
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    if (view.getUint32(0, true) !== 0x02014b50) {
      throw new PlayerError("ZIP_ERROR", "Recording ZIP contains an invalid central-directory entry");
    }
    const bitFlag = view.getUint16(8, true);
    const compressedSize32 = view.getUint32(20, true);
    const uncompressedSize32 = view.getUint32(24, true);
    const nameLength = view.getUint16(28, true);
    const extraLength = view.getUint16(30, true);
    const commentLength = view.getUint16(32, true);
    const diskNumberStart = view.getUint16(34, true);
    const externalAttributes = view.getUint32(38, true);
    const localOffset32 = view.getUint32(42, true);
    const entryLength = 46 + nameLength + extraLength + commentLength;
    if (cursor + entryLength > centralEnd) {
      throw new PlayerError("ZIP_ERROR", "Recording ZIP contains a truncated central-directory entry");
    }
    const centralName = await reader.read(cursor + 46, nameLength);
    const extraBytes = await reader.read(cursor + 46 + nameLength, extraLength);
    const extraFields = zipExtraFields(extraBytes);
    let uncompressedSize = uncompressedSize32;
    let localOffset = localOffset32;
    if (uncompressedSize32 === 0xffffffff || compressedSize32 === 0xffffffff || localOffset32 === 0xffffffff) {
      const zip64 = extraFields.get(0x0001);
      if (!zip64) throw new PlayerError("ZIP_ERROR", "Recording ZIP entry is missing its ZIP64 size data");
      const zip64View = new DataView(zip64.buffer, zip64.byteOffset, zip64.byteLength);
      let zip64Offset = 0;
      const readZip64Value = () => {
        if (zip64Offset + 8 > zip64.byteLength) {
          throw new PlayerError("ZIP_ERROR", "Recording ZIP entry has truncated ZIP64 size data");
        }
        const result = uint64(zip64View, zip64Offset);
        zip64Offset += 8;
        return result;
      };
      if (uncompressedSize32 === 0xffffffff) uncompressedSize = readZip64Value();
      if (compressedSize32 === 0xffffffff) readZip64Value();
      if (localOffset32 === 0xffffffff) localOffset = readZip64Value();
      if (diskNumberStart === 0xffff && zip64Offset + 4 > zip64.byteLength) {
        throw new PlayerError("ZIP_ERROR", "Recording ZIP entry has truncated ZIP64 disk data");
      }
    }

    const actualLocalOffset = localOffset + offsetAdjustment;
    const localHeader = await reader.read(actualLocalOffset, 30);
    const localView = new DataView(localHeader.buffer, localHeader.byteOffset, localHeader.byteLength);
    if (localView.getUint32(0, true) !== 0x04034b50) {
      throw new PlayerError("ZIP_ERROR", "Recording ZIP entry has an invalid local header");
    }
    const localNameLength = localView.getUint16(26, true);
    const localExtraLength = localView.getUint16(28, true);
    if (actualLocalOffset + 30 + localNameLength + localExtraLength > reader.length) {
      throw new PlayerError("ZIP_ERROR", "Recording ZIP entry has a truncated local header");
    }
    const localName = await reader.read(actualLocalOffset + 30, localNameLength);
    const decodedLocalName = bitFlag & 0x0800
      ? new TextDecoder("utf-8").decode(localName)
      : unicodeZipName(localName, extraFields.get(0x7075)) ?? new TextDecoder("utf-8").decode(localName);
    const decodedCentralName = bitFlag & 0x0800
      ? new TextDecoder("utf-8").decode(centralName)
      : unicodeZipName(centralName, extraFields.get(0x7075)) ?? new TextDecoder("utf-8").decode(centralName);
    const normalizedLocalName = resolveZipPath(decodedLocalName);
    const normalizedCentralName = resolveZipPath(decodedCentralName);
    const names = new Set([normalizedLocalName, normalizedCentralName]);
    // A forged directory marker in one header must not suppress a reserved
    // Twee filename carried by the other. ZIP readers disagree about which
    // header wins, so conservatively classify either non-directory view.
    const localIsDirectory = decodedLocalName.endsWith("/");
    const centralIsDirectory = Boolean(externalAttributes & 0x0010) || decodedCentralName.endsWith("/");
    entryCount++;
    if (
      (!localIsDirectory && normalizedLocalName === "manifest.json") ||
      (!centralIsDirectory && normalizedCentralName === "manifest.json")
    ) manifestCount++;
    if (
      (!localIsDirectory && normalizedLocalName === "events.jsonl") ||
      (!centralIsDirectory && normalizedCentralName === "events.jsonl")
    ) eventsCount++;
    if (uncompressedSize > TWEE_PARSER_LIMITS.expandedFileBytes && firstOversizedEntry == null) {
      firstOversizedEntry = [...names].find(Boolean) || "archive entry";
    }

    const isTwee = manifestCount > 0 || eventsCount > 0;
    if (isTwee) {
      if (reader.length > TWEE_PARSER_LIMITS.zipBytes) {
        throw new PlayerError(
          "LIMIT_ERROR",
          `Twee recording ZIP exceeds the ${TWEE_PARSER_LIMITS.zipBytes}-byte input limit`,
        );
      }
      if (expectedEntries > TWEE_PARSER_LIMITS.files || entryCount > TWEE_PARSER_LIMITS.files) {
        throw new PlayerError("LIMIT_ERROR", `Twee recording ZIP exceeds the ${TWEE_PARSER_LIMITS.files}-file limit`);
      }
      if (firstOversizedEntry != null) {
        throw new PlayerError(
          "LIMIT_ERROR",
          `${firstOversizedEntry} exceeds the ${TWEE_PARSER_LIMITS.expandedFileBytes}-byte expanded-file limit`,
        );
      }
    }
    cursor += entryLength;
  }

  if (cursor !== centralEnd || entryCount !== expectedEntries) {
    throw new PlayerError("ZIP_ERROR", "Recording ZIP directory entry count does not match its contents");
  }
  const isTwee = manifestCount > 0 || eventsCount > 0;
  if (isTwee && (manifestCount > 1 || eventsCount > 1)) {
    throw new PlayerError("PARSE_ERROR", "Twee recording contains duplicate manifest.json or events.jsonl entries");
  }
  return { isTwee, entryCount };
}

type ZipFileWithInternals = ZipFile & {
  _data?: { uncompressedSize?: unknown };
  internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
};

function declaredExpandedSize(file: ZipFile): number | undefined {
  const value = (file as ZipFileWithInternals)._data?.uncompressedSize;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function assertExpandedSize(file: ZipFile, limit: number, label: string): void {
  const size = declaredExpandedSize(file);
  if (size != null && size > limit) {
    throw new PlayerError("LIMIT_ERROR", `${label} exceeds the ${limit}-byte expanded-file limit`);
  }
}

async function forEachZipChunk(
  file: ZipFile,
  limit: number,
  label: string,
  visit: (chunk: Uint8Array) => void,
): Promise<void> {
  assertExpandedSize(file, limit, label);
  // JSZip's browser stream exists at runtime but is missing from its
  // JSZipObject declaration. Using it lets us stop before accumulating a
  // forged archive entry whose real expanded size exceeds its header value.
  const stream = (file as ZipFileWithInternals).internalStream("uint8array");
  await new Promise<void>((resolve, reject) => {
    let total = 0;
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      stream.pause();
      reject(error);
    };
    stream.on("data", (chunk) => {
      if (settled) return;
      total += chunk.byteLength;
      if (total > limit) {
        fail(new PlayerError("LIMIT_ERROR", `${label} exceeds the ${limit}-byte expanded-file limit`));
        return;
      }
      try {
        visit(chunk);
      } catch (cause) {
        fail(cause);
      }
    });
    stream.on("error", fail);
    stream.on("end", () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    stream.resume();
  });
}

async function readZipText(file: ZipFile, limit: number, label: string): Promise<string> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  try {
    await forEachZipChunk(file, limit, label, (chunk) => {
      chunks.push(decoder.decode(chunk, { stream: true }));
    });
    chunks.push(decoder.decode());
  } catch (cause) {
    if (cause instanceof PlayerError) throw cause;
    throw new PlayerError("PARSE_ERROR", `${label} is not valid UTF-8`, { cause });
  }
  return chunks.join("");
}

function optionalString(value: unknown, context: string): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") throw new PlayerError("PARSE_ERROR", `${context} must be a string`);
  return value;
}

function optionalSafeInteger(value: unknown, context: string, minimum = Number.MIN_SAFE_INTEGER): number | undefined {
  if (value == null) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new PlayerError("PARSE_ERROR", `${context} must be an integer of at least ${minimum}`);
  }
  return value as number;
}

function terminalDimension(value: unknown, name: "cols" | "rows", context: string): number {
  const maximum = name === "cols" ? TWEE_PARSER_LIMITS.terminalColumns : TWEE_PARSER_LIMITS.terminalRows;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new PlayerError("PARSE_ERROR", `${context}.${name} must be a positive integer`);
  }
  if ((value as number) > maximum) {
    throw new PlayerError("LIMIT_ERROR", `${context}.${name} exceeds the terminal ${name} limit of ${maximum}`);
  }
  return value as number;
}

function terminalSize(cols: unknown, rows: unknown, context: string): { cols: number; rows: number } {
  const dimensions = {
    cols: terminalDimension(cols, "cols", context),
    rows: terminalDimension(rows, "rows", context),
  };
  if (dimensions.cols * dimensions.rows > TWEE_PARSER_LIMITS.terminalCells) {
    throw new PlayerError(
      "LIMIT_ERROR",
      `${context} exceeds the ${TWEE_PARSER_LIMITS.terminalCells}-cell terminal limit`,
    );
  }
  return dimensions;
}

function parseStringMap(value: unknown, context: string): Record<string, string> | undefined {
  if (value == null) return undefined;
  const raw = requireRecord(value, context);
  const parsed = Object.create(null) as Record<string, string>;
  for (const [key, item] of Object.entries(raw)) {
    if (typeof item !== "string") throw new PlayerError("PARSE_ERROR", `${context}.${key} must be a string`);
    parsed[key] = item;
  }
  return parsed;
}

function parseManifest(text: string): TweeManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new PlayerError("PARSE_ERROR", "Invalid JSON in manifest.json", { cause });
  }
  const raw = requireRecord(value, "manifest.json");
  if (raw.version !== 1) {
    const version = raw.version == null ? "missing" : JSON.stringify(raw.version);
    throw new PlayerError("PARSE_ERROR", `Unsupported Twee recording version ${version}; expected version 1`);
  }
  const { cols, rows } = terminalSize(raw.cols, raw.rows, "manifest.json");

  let command: string[] = [];
  if (raw.command != null) {
    if (!Array.isArray(raw.command) || raw.command.some((part) => typeof part !== "string")) {
      throw new PlayerError("PARSE_ERROR", "manifest.json.command must be an array of strings");
    }
    command = [...raw.command];
  }

  let host: TweeHostInfo | undefined;
  if (raw.host != null) {
    const hostValue = requireRecord(raw.host, "manifest.json.host");
    const os = optionalString(hostValue.os, "manifest.json.host.os");
    const arch = optionalString(hostValue.arch, "manifest.json.host.arch");
    const hostname = optionalString(hostValue.hostname, "manifest.json.host.hostname");
    if (os == null || arch == null || hostname == null) {
      throw new PlayerError("PARSE_ERROR", "manifest.json.host must contain string os, arch, and hostname values");
    }
    host = { os, arch, hostname };
  }

  const startedAt = optionalString(raw.started_at, "manifest.json.started_at");
  const stoppedAt = optionalString(raw.stopped_at, "manifest.json.stopped_at");
  const startedMs = startedAt == null ? undefined : Date.parse(startedAt);
  const stoppedMs = stoppedAt == null ? undefined : Date.parse(stoppedAt);
  if (startedMs != null && !Number.isFinite(startedMs)) {
    throw new PlayerError("PARSE_ERROR", "manifest.json.started_at must be a valid timestamp");
  }
  if (stoppedMs != null && !Number.isFinite(stoppedMs)) {
    throw new PlayerError("PARSE_ERROR", "manifest.json.stopped_at must be a valid timestamp");
  }
  if (startedMs != null && stoppedMs != null && stoppedMs < startedMs) {
    throw new PlayerError("PARSE_ERROR", "manifest.json.stopped_at must not be before started_at");
  }

  return {
    version: 1,
    command,
    cols,
    rows,
    env: parseStringMap(raw.env, "manifest.json.env"),
    pid: optionalSafeInteger(raw.pid, "manifest.json.pid", 0),
    host,
    startedAt,
    stoppedAt,
  };
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUES = (() => {
  const values = new Int16Array(128).fill(-1);
  for (let index = 0; index < BASE64_ALPHABET.length; index++) {
    values[BASE64_ALPHABET.charCodeAt(index)] = index;
  }
  return values;
})();

function decodeBase64(value: unknown, context: string): Uint8Array {
  if (value == null) return new Uint8Array();
  if (typeof value !== "string") throw new PlayerError("PARSE_ERROR", `${context} must be a Base64 string`);
  if (value.length % 4 !== 0) throw new PlayerError("PARSE_ERROR", `${context} is not valid Base64`);
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  for (let index = 0; index < value.length - padding; index++) {
    const code = value.charCodeAt(index);
    if (code >= BASE64_VALUES.length || BASE64_VALUES[code] < 0) {
      throw new PlayerError("PARSE_ERROR", `${context} is not valid Base64`);
    }
  }
  for (let index = value.length - padding; index < value.length; index++) {
    if (value[index] !== "=") throw new PlayerError("PARSE_ERROR", `${context} is not valid Base64`);
  }
  if (
    (padding === 2 && (BASE64_VALUES[value.charCodeAt(value.length - 3)] & 0x0f) !== 0) ||
    (padding === 1 && (BASE64_VALUES[value.charCodeAt(value.length - 2)] & 0x03) !== 0)
  ) {
    throw new PlayerError("PARSE_ERROR", `${context} is not canonical Base64`);
  }
  const decodedLength = (value.length / 4) * 3 - padding;
  if (decodedLength > TWEE_PARSER_LIMITS.eventPayloadBytes) {
    throw new PlayerError(
      "LIMIT_ERROR",
      `${context} exceeds the ${TWEE_PARSER_LIMITS.eventPayloadBytes}-byte event payload limit`,
    );
  }
  const result = new Uint8Array(decodedLength);
  let outputIndex = 0;
  for (let index = 0; index < value.length; index += 4) {
    const a = BASE64_VALUES[value.charCodeAt(index)];
    const b = BASE64_VALUES[value.charCodeAt(index + 1)];
    const c = value[index + 2] === "=" ? 0 : BASE64_VALUES[value.charCodeAt(index + 2)];
    const d = value[index + 3] === "=" ? 0 : BASE64_VALUES[value.charCodeAt(index + 3)];
    const bits = (a << 18) | (b << 12) | (c << 6) | d;
    if (outputIndex < decodedLength) result[outputIndex++] = (bits >>> 16) & 0xff;
    if (outputIndex < decodedLength) result[outputIndex++] = (bits >>> 8) & 0xff;
    if (outputIndex < decodedLength) result[outputIndex++] = bits & 0xff;
  }
  return result;
}

function parseMouse(value: unknown, context: string): TweeMouseInput | undefined {
  if (value == null) return undefined;
  const raw = requireRecord(value, context);
  const gesture = optionalString(raw.gesture, `${context}.gesture`);
  if (gesture == null) throw new PlayerError("PARSE_ERROR", `${context}.gesture must be a string`);
  const modifiers = raw.modifiers == null ? [] : raw.modifiers;
  if (!Array.isArray(modifiers) || modifiers.some((modifier) => typeof modifier !== "string")) {
    throw new PlayerError("PARSE_ERROR", `${context}.modifiers must be an array of strings`);
  }
  return {
    gesture,
    x: optionalSafeInteger(raw.x, `${context}.x`),
    y: optionalSafeInteger(raw.y, `${context}.y`),
    fromX: optionalSafeInteger(raw.from_x, `${context}.from_x`),
    fromY: optionalSafeInteger(raw.from_y, `${context}.from_y`),
    toX: optionalSafeInteger(raw.to_x, `${context}.to_x`),
    toY: optionalSafeInteger(raw.to_y, `${context}.to_y`),
    button: optionalString(raw.button, `${context}.button`),
    modifiers: [...modifiers],
    direction: optionalString(raw.direction, `${context}.direction`),
    ticks: optionalSafeInteger(raw.ticks, `${context}.ticks`),
  };
}

function parseTweeEvent(line: string, lineNumber: number, index: number): TweeEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (cause) {
    throw new PlayerError("PARSE_ERROR", `Invalid JSON in events.jsonl on line ${lineNumber}`, { cause });
  }
  const context = `events.jsonl line ${lineNumber}`;
  const raw = requireRecord(value, context);
  const time = optionalSafeInteger(raw.t_ms, `${context}.t_ms`, 0) ?? 0;
  const id = `twee-${index}`;

  switch (raw.type) {
    case "output":
      return { id, time, type: "output", bytes: decodeBase64(raw.bytes_b64, `${context}.bytes_b64`) };
    case "input":
      return {
        id,
        time,
        type: "input",
        bytes: decodeBase64(raw.bytes_b64, `${context}.bytes_b64`),
        inputKind: optionalString(raw.kind, `${context}.kind`),
        key: optionalString(raw.key, `${context}.key`),
        mouse: parseMouse(raw.mouse, `${context}.mouse`),
      };
    case "resize": {
      const { cols, rows } = terminalSize(raw.cols, raw.rows, context);
      return { id, time, type: "resize", cols, rows };
    }
    case "exit": {
      // Go's `omitempty` leaves a successful (zero) exit code out of the JSON.
      const code = optionalSafeInteger(raw.code, `${context}.code`) ?? 0;
      return { id, time, type: "exit", code };
    }
    default:
      throw new PlayerError("PARSE_ERROR", `${context} has unknown event type ${JSON.stringify(raw.type)}`);
  }
}

async function parseTweeEvents(file: ZipFile): Promise<TweeEvent[]> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const events: TweeEvent[] = [];
  const pending: string[] = [];
  let pendingLength = 0;
  let lineNumber = 0;
  const maxLineLength = Math.ceil((TWEE_PARSER_LIMITS.eventPayloadBytes * 4) / 3) + 64 * 1024;

  const consume = (text: string, final: boolean) => {
    const parts = text.split("\n");
    for (let index = 0; index < parts.length; index++) {
      const terminated = index < parts.length - 1;
      const part = parts[index];
      pendingLength += part.length;
      if (pendingLength > maxLineLength) {
        throw new PlayerError("LIMIT_ERROR", `events.jsonl line ${lineNumber + 1} exceeds the event-line limit`);
      }
      pending.push(part);
      if (!terminated && !final) continue;
      if (!terminated && final && part === "" && pending.length === 1) continue;
      lineNumber++;
      const line = pending.join("").trim();
      pending.length = 0;
      pendingLength = 0;
      if (!line) continue;
      if (events.length >= TWEE_PARSER_LIMITS.events) {
        throw new PlayerError("LIMIT_ERROR", `events.jsonl exceeds the ${TWEE_PARSER_LIMITS.events}-event limit`);
      }
      events.push(parseTweeEvent(line, lineNumber, events.length));
    }
  };

  try {
    await forEachZipChunk(file, TWEE_PARSER_LIMITS.expandedFileBytes, "events.jsonl", (chunk) => {
      consume(decoder.decode(chunk, { stream: true }), false);
    });
    consume(decoder.decode(), true);
  } catch (cause) {
    if (cause instanceof PlayerError) throw cause;
    throw new PlayerError("PARSE_ERROR", "events.jsonl is not valid UTF-8", { cause });
  }
  return events;
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

// Vibium/Playwright traces split each call into before/input/after lines that
// share a callId; only "before" carries a start time and only "after" carries
// an end time. Fold them into the opening event so a call is one action with
// a real duration instead of three events, two of which have no usable time.
function mergeCallLifecycles(events: RecordingEvent[]): RecordingEvent[] {
  const merged: RecordingEvent[] = [];
  const openByCallId = new Map<string, RecordingEvent>();
  for (const event of events) {
    const callId = asRecord(event.data).callId;
    if (typeof callId !== "string" || callId === "") {
      merged.push(event);
      continue;
    }
    if (event.type === "before") {
      openByCallId.set(callId, event);
      merged.push(event);
      continue;
    }
    const opener = event.type === "after" || event.type === "input" ? openByCallId.get(callId) : undefined;
    if (!opener) {
      merged.push(event);
      continue;
    }
    if (event.type === "after") {
      if (event.endTime != null) {
        opener.endTime = event.endTime;
        opener.duration = Math.max(0, event.endTime - opener.time);
      }
      opener.data = { ...opener.data, after: event.data };
    } else {
      opener.data = { ...opener.data, input: event.data };
    }
  }
  return merged;
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

function requiredZipFile(zipFiles: Record<string, ZipFile>, name: string): ZipFile {
  const file = zipFiles[name];
  if (!file || file.dir) throw new PlayerError("PARSE_ERROR", `Twee recording is missing ${name}`);
  return file;
}

async function parseTweeRecording(
  files: string[],
  zipFiles: Record<string, ZipFile>,
  options: ParseRecordingOptions,
): Promise<TweeRecording> {
  const manifestFile = requiredZipFile(zipFiles, "manifest.json");
  const eventsFile = requiredZipFile(zipFiles, "events.jsonl");
  const manifest = parseManifest(
    await readZipText(manifestFile, TWEE_PARSER_LIMITS.manifestBytes, "manifest.json"),
  );
  const terminalEvents = await parseTweeEvents(eventsFile);
  // Twee event timestamps are elapsed milliseconds from trace start. Playback
  // ends when the event stream ends; stopped_at only records when the trace was
  // finalized and may include an arbitrarily long quiet tail after the final
  // terminal event.
  const duration = terminalEvents.reduce((maximum, event) => Math.max(maximum, event.time), 0);

  return {
    version: 1,
    format: "twee",
    source: options.source,
    files,
    metadata: {
      fileCount: files.length,
      eventCount: terminalEvents.length,
    },
    timeline: {
      startTime: 0,
      endTime: duration,
      duration,
      events: terminalEvents,
    },
    presentation: {
      kind: "terminal",
      initialCols: manifest.cols,
      initialRows: manifest.rows,
    },
    manifest,
    terminalEvents,
  };
}

async function parseVibiumRecording(
  files: string[],
  zipFiles: Record<string, ZipFile>,
  options: ParseRecordingOptions,
): Promise<VibiumRecording> {
  const traceEvents = await readEvents(files, zipFiles, ".trace");
  const networkEvents = await readEvents(files, zipFiles, ".network");
  const resources = await readResources(files, zipFiles, options.includeResourceDataUrls ?? true);
  const allRawEvents = [...traceEvents, ...networkEvents].filter(isTimelineEvent);
  const events = mergeCallLifecycles(allRawEvents.map(normalizeEvent));
  const screenshots = extractScreenshotRefs(traceEvents, resources);
  const contextOptions = traceEvents.map(asRecord).find((event) => event.type === "context-options");

  return {
    version: 1,
    format: "vibium",
    presentation: { kind: "screenshot" },
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

  let preflight: ZipPreflightResult;
  let zip: JSZip;
  try {
    preflight = await preflightZip(data);
    zip = await JSZip.loadAsync(data);
  } catch (cause) {
    if (cause instanceof PlayerError) throw cause;
    throw new PlayerError("ZIP_ERROR", "Unable to read recording ZIP", { cause });
  }

  try {
    const files = Object.keys(zip.files).sort();
    // Seeing either reserved root entry is enough to route to the Twee parser,
    // so an incomplete Twee archive gets a useful missing-file error instead
    // of being mistaken for an empty Vibium trace.
    const maybeTwee = preflight.isTwee || Boolean(zip.files["manifest.json"] || zip.files["events.jsonl"]);
    if (maybeTwee) {
      for (const name of files) {
        const file = zip.files[name];
        if (!file.dir) assertExpandedSize(file, TWEE_PARSER_LIMITS.expandedFileBytes, name);
      }
    }
    return maybeTwee
      ? await parseTweeRecording(files, zip.files, options)
      : await parseVibiumRecording(files, zip.files, options);
  } catch (cause) {
    if (cause instanceof PlayerError) throw cause;
    throw new PlayerError("PARSE_ERROR", "Unable to parse recording contents", { cause });
  }
}

/**
 * Inspect only the ZIP structure needed to choose a recording adapter.
 * This keeps the hosted Vibium path tolerant of legacy NDJSON while still
 * routing incomplete or malformed Twee bundles to the strict Twee parser.
 */
export async function detectRecordingFormat(
  data: ArrayBuffer | Uint8Array | Blob,
): Promise<RecordingFormat> {
  if (
    !(data instanceof ArrayBuffer) &&
    !ArrayBuffer.isView(data) &&
    !(typeof Blob !== "undefined" && data instanceof Blob)
  ) {
    throw new PlayerError(
      "INVALID_INPUT",
      "detectRecordingFormat expects an ArrayBuffer, Uint8Array, or Blob",
    );
  }

  try {
    return (await preflightZip(data)).isTwee ? "twee" : "vibium";
  } catch (cause) {
    if (cause instanceof PlayerError) throw cause;
    throw new PlayerError("ZIP_ERROR", "Unable to inspect recording ZIP", { cause });
  }
}

function downloadLimit(options: LoadRecordingOptions, url: string): number | undefined {
  const configured = options.maxDownloadBytes !== undefined;
  const limit = options.maxDownloadBytes;
  if (configured && (!Number.isSafeInteger(limit) || limit == null || limit <= 0 || limit > TWEE_PARSER_LIMITS.zipBytes)) {
    throw new PlayerError(
      "INVALID_INPUT",
      `maxDownloadBytes must be a positive integer no greater than ${TWEE_PARSER_LIMITS.zipBytes}`,
    );
  }

  if (configured) return limit;

  // A .twee URL is known before its response is consumed, so enforce the
  // archive cap while streaming. Generic .zip URLs remain content-detected:
  // imposing the Twee cap on them would regress existing large Vibium files.
  // parseRecording still preflights a detected Twee archive before JSZip
  // expands it, regardless of the URL suffix.
  try {
    const pathname = new URL(url, "https://record-player.invalid").pathname;
    return pathname.toLowerCase().endsWith(".twee") ? TWEE_PARSER_LIMITS.zipBytes : undefined;
  } catch {
    return undefined;
  }
}

function contentLengthExceeds(response: Response, limit: number): boolean {
  const value = response.headers.get("content-length")?.trim();
  if (!value || !/^\d+$/.test(value)) return false;
  const normalized = value.replace(/^0+/, "") || "0";
  const maximum = String(limit);
  return normalized.length > maximum.length || (normalized.length === maximum.length && normalized > maximum);
}

function cancelResponseBody(response: Response, reason: string): void {
  try {
    void response.body?.cancel(reason).catch(() => undefined);
  } catch {
    // Cancellation is best effort. Keep the size-limit error as the public
    // result even if the fetch implementation has already closed the body.
  }
}

async function readResponse(response: Response, limit: number | undefined, url: string): Promise<Uint8Array> {
  if (limit == null) {
    try {
      return new Uint8Array(await response.arrayBuffer());
    } catch (cause) {
      throw new PlayerError("FETCH_ERROR", `Failed to read recording: ${url}`, { cause });
    }
  }

  if (contentLengthExceeds(response, limit)) {
    cancelResponseBody(response, "recording download exceeds configured limit");
    throw new PlayerError("LIMIT_ERROR", `Recording download exceeds the ${limit}-byte limit`);
  }

  if (!response.body) {
    // A bodyless fetch/polyfill can only report the actual size after
    // arrayBuffer() has allocated it, which would make maxDownloadBytes a
    // misleading security boundary. Fail closed whenever a bound applies.
    throw new PlayerError(
      "FETCH_ERROR",
      `Cannot enforce the ${limit}-byte recording limit because the response body is not streamable`,
    );
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (value.byteLength > limit - total) {
        try {
          void reader.cancel("recording download exceeds configured limit").catch(() => undefined);
        } catch {
          // Preserve the deterministic limit error if cancellation itself
          // races with a closed or aborted network stream.
        }
        throw new PlayerError("LIMIT_ERROR", `Recording download exceeds the ${limit}-byte limit`);
      }
      total += value.byteLength;
      chunks.push(value);
    }
  } catch (cause) {
    if (cause instanceof PlayerError) throw cause;
    throw new PlayerError("FETCH_ERROR", `Failed to read recording: ${url}`, { cause });
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function loadRecording(source: URL | string, options: LoadRecordingOptions = {}): Promise<LoadedRecording> {
  const url = source instanceof URL ? source.toString() : source;
  if (typeof url !== "string" || !url) {
    throw new PlayerError("INVALID_INPUT", "loadRecording expects a URL or URL string");
  }
  const limit = downloadLimit(options, url);
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

  // Preserve a cap selected from the requested URL, and also recognize a
  // redirect whose final URL exposes the .twee suffix.
  const effectiveLimit = limit ?? downloadLimit({}, response.url);
  const data = await readResponse(response, effectiveLimit, url);
  return parseRecording(data, { ...options, source: url });
}
