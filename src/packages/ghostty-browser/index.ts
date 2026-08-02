/**
 * Browser bindings for the libghostty-vt WebAssembly build bundled beside
 * this module. This package intentionally has no React or DOM dependency.
 */

export interface GhosttyTerminal {
  write(data: Uint8Array): void;
  resize(cols: number, rows: number): void;
  reset(cols: number, rows: number): void;
  /** Returns untrusted formatter output; sanitize it before inserting into a document. */
  formatHTML(): string;
  dispose(): void;
}

export interface GhosttyTerminalLoadOptions {
  /** Override the bundled asset location, for example when self-hosting it. */
  wasmUrl?: string | URL;
  /** Override fetch for non-browser hosts or request instrumentation. */
  fetch?: typeof globalThis.fetch;
  /** Receives libghostty diagnostic messages. The default discards them. */
  log?: (message: string) => void;
}

export interface GhosttyTerminalWasmOptions {
  /** Receives libghostty diagnostic messages. The default discards them. */
  log?: (message: string) => void;
}

export type GhosttyWasmSource = BufferSource | WebAssembly.Module;

/**
 * Vite rewrites this URL to an emitted application asset (or a library-build
 * data URL), leaving normal builds independent of Zig and the Ghostty repo.
 */
export const ghosttyWasmUrl = new URL("./assets/ghostty-vt.wasm", import.meta.url);

const GHOSTTY_SUCCESS = 0;
const GHOSTTY_FORMATTER_FORMAT_HTML = 2;

type WasmFunction = (...args: number[]) => number;

interface GhosttyExports {
  memory: WebAssembly.Memory;
  ghostty_type_json: WasmFunction;
  ghostty_alloc: WasmFunction;
  ghostty_free: WasmFunction;
  ghostty_wasm_alloc_opaque: WasmFunction;
  ghostty_wasm_free_opaque: WasmFunction;
  ghostty_wasm_alloc_u8_array: WasmFunction;
  ghostty_wasm_free_u8_array: WasmFunction;
  ghostty_wasm_alloc_usize: WasmFunction;
  ghostty_wasm_free_usize: WasmFunction;
  ghostty_terminal_new: WasmFunction;
  ghostty_terminal_free: WasmFunction;
  ghostty_terminal_reset: WasmFunction;
  ghostty_terminal_resize: WasmFunction;
  ghostty_terminal_vt_write: WasmFunction;
  ghostty_formatter_terminal_new: WasmFunction;
  ghostty_formatter_format_alloc: WasmFunction;
  ghostty_formatter_free: WasmFunction;
}

interface FieldLayout {
  offset: number;
  size: number;
  type: string;
}

interface StructLayout {
  size: number;
  align: number;
  fields: Record<string, FieldLayout>;
}

type TypeLayouts = Record<string, StructLayout>;

interface TerminalHandles {
  terminal: number;
  formatter: number;
}

class GhosttyRuntime {
  readonly exports: GhosttyExports;
  readonly layouts: TypeLayouts;
  private readonly decoder = new TextDecoder();
  private readonly pointerSize: number;

  constructor(instance: WebAssembly.Instance) {
    this.exports = requireExports(instance.exports);
    this.layouts = this.readTypeLayouts();

    // Opaque handles use the same representation as the formatter selection
    // pointer. Its size is target-derived metadata, not a TS ABI constant.
    this.pointerSize = this.field("GhosttyFormatterTerminalOptions", "selection").size;
    if (this.pointerSize !== 4) {
      throw new Error(`Unsupported libghostty WASM pointer size: ${this.pointerSize}`);
    }
  }

  create(cols: number, rows: number): TerminalHandles {
    validateSize(cols, rows);

    let terminal = 0;
    let formatter = 0;
    try {
      terminal = this.createTerminal(cols, rows);
      formatter = this.createFormatter(terminal);
      return { terminal, formatter };
    } catch (error) {
      if (formatter !== 0) this.exports.ghostty_formatter_free(formatter);
      if (terminal !== 0) this.exports.ghostty_terminal_free(terminal);
      throw error;
    }
  }

  write(terminal: number, data: Uint8Array): void {
    if (data.byteLength === 0) return;

    const dataPtr = this.exports.ghostty_wasm_alloc_u8_array(data.byteLength);
    if (dataPtr === 0) throw new Error("libghostty could not allocate a write buffer");

    try {
      // The allocation can grow WASM memory, so construct the view afterward.
      new Uint8Array(this.exports.memory.buffer, dataPtr, data.byteLength).set(data);
      this.exports.ghostty_terminal_vt_write(terminal, dataPtr, data.byteLength);
    } finally {
      this.exports.ghostty_wasm_free_u8_array(dataPtr, data.byteLength);
    }
  }

  resize(terminal: number, cols: number, rows: number): void {
    validateSize(cols, rows);
    assertSuccess(
      "ghostty_terminal_resize",
      this.exports.ghostty_terminal_resize(terminal, cols, rows, 0, 0),
    );
  }

  reset(terminal: number, cols: number, rows: number): void {
    validateSize(cols, rows);
    this.exports.ghostty_terminal_reset(terminal);
    this.resize(terminal, cols, rows);
  }

  formatHTML(formatter: number): string {
    const outPtrPtr = this.allocOpaque();
    const outLenPtr = this.exports.ghostty_wasm_alloc_usize();
    if (outLenPtr === 0) {
      this.exports.ghostty_wasm_free_opaque(outPtrPtr);
      throw new Error("libghostty could not allocate formatter output length storage");
    }

    this.writePointer(outPtrPtr, 0);
    this.writeUnsigned(outLenPtr, this.pointerSize, 0);

    let outPtr = 0;
    let outLen = 0;
    try {
      assertSuccess(
        "ghostty_formatter_format_alloc",
        this.exports.ghostty_formatter_format_alloc(formatter, 0, outPtrPtr, outLenPtr),
      );

      // Formatting can grow memory, so read both values from fresh views.
      outPtr = this.readPointer(outPtrPtr);
      outLen = this.readUnsigned(outLenPtr, this.pointerSize);
      if (outLen === 0) return "";
      if (outPtr === 0) throw new Error("libghostty returned a null formatter output buffer");

      // Decode before freeing: the returned slice is owned by libghostty.
      return this.decoder.decode(new Uint8Array(this.exports.memory.buffer, outPtr, outLen));
    } finally {
      if (outPtr !== 0) this.exports.ghostty_free(0, outPtr, outLen);
      this.exports.ghostty_wasm_free_opaque(outPtrPtr);
      this.exports.ghostty_wasm_free_usize(outLenPtr);
    }
  }

  private createTerminal(cols: number, rows: number): number {
    const structName = "GhosttyTerminalOptions";
    const optsPtr = this.allocStruct(structName);
    const terminalPtrPtr = this.allocOpaque();
    try {
      this.setField(optsPtr, structName, "cols", cols);
      this.setField(optsPtr, structName, "rows", rows);
      this.setField(optsPtr, structName, "max_scrollback", 0);
      this.writePointer(terminalPtrPtr, 0);

      assertSuccess(
        "ghostty_terminal_new",
        this.exports.ghostty_terminal_new(0, terminalPtrPtr, optsPtr),
      );
      const terminal = this.readPointer(terminalPtrPtr);
      if (terminal === 0) throw new Error("libghostty returned a null terminal handle");
      return terminal;
    } finally {
      this.freeStruct(optsPtr, structName);
      this.exports.ghostty_wasm_free_opaque(terminalPtrPtr);
    }
  }

  private createFormatter(terminal: number): number {
    const structName = "GhosttyFormatterTerminalOptions";
    const extraName = "GhosttyFormatterTerminalExtra";
    const screenName = "GhosttyFormatterScreenExtra";
    const optsPtr = this.allocStruct(structName);
    const formatterPtrPtr = this.allocOpaque();
    try {
      this.setField(optsPtr, structName, "size", this.struct(structName).size);
      this.setField(optsPtr, structName, "emit", GHOSTTY_FORMATTER_FORMAT_HTML);
      this.setField(optsPtr, structName, "unwrap", 0);
      this.setField(optsPtr, structName, "trim", 0);

      const extraPtr = optsPtr + this.field(structName, "extra").offset;
      this.setField(extraPtr, extraName, "size", this.struct(extraName).size);
      // HTML cells refer to vt-palette variables; emit their definitions too.
      this.setField(extraPtr, extraName, "palette", 1);

      const screenPtr = extraPtr + this.field(extraName, "screen").offset;
      this.setField(screenPtr, screenName, "size", this.struct(screenName).size);
      this.writePointer(formatterPtrPtr, 0);

      assertSuccess(
        "ghostty_formatter_terminal_new",
        this.exports.ghostty_formatter_terminal_new(0, formatterPtrPtr, terminal, optsPtr),
      );
      const formatter = this.readPointer(formatterPtrPtr);
      if (formatter === 0) throw new Error("libghostty returned a null formatter handle");
      return formatter;
    } finally {
      this.freeStruct(optsPtr, structName);
      this.exports.ghostty_wasm_free_opaque(formatterPtrPtr);
    }
  }

  private readTypeLayouts(): TypeLayouts {
    const jsonPtr = this.exports.ghostty_type_json();
    if (jsonPtr === 0) throw new Error("libghostty returned a null type-layout pointer");

    const bytes = new Uint8Array(
      this.exports.memory.buffer,
      jsonPtr,
      this.exports.memory.buffer.byteLength - jsonPtr,
    );
    const terminator = bytes.indexOf(0);
    if (terminator < 0) throw new Error("libghostty type-layout JSON is not NUL-terminated");

    let value: unknown;
    try {
      value = JSON.parse(this.decoder.decode(bytes.subarray(0, terminator)));
    } catch {
      throw new Error("libghostty returned invalid type-layout JSON");
    }
    if (!value || typeof value !== "object") {
      throw new Error("libghostty type-layout JSON must contain an object");
    }
    return value as TypeLayouts;
  }

  private allocStruct(name: string): number {
    const size = this.struct(name).size;
    const ptr = this.exports.ghostty_wasm_alloc_u8_array(size);
    if (ptr === 0) throw new Error(`libghostty could not allocate ${name}`);
    new Uint8Array(this.exports.memory.buffer, ptr, size).fill(0);
    return ptr;
  }

  private freeStruct(ptr: number, name: string): void {
    this.exports.ghostty_wasm_free_u8_array(ptr, this.struct(name).size);
  }

  private allocOpaque(): number {
    const ptr = this.exports.ghostty_wasm_alloc_opaque();
    if (ptr === 0) throw new Error("libghostty could not allocate handle storage");
    return ptr;
  }

  private struct(name: string): StructLayout {
    const layout = this.layouts[name];
    if (!layout || !Number.isInteger(layout.size) || !layout.fields) {
      throw new Error(`libghostty type-layout JSON is missing ${name}`);
    }
    return layout;
  }

  private field(structName: string, fieldName: string): FieldLayout {
    const field = this.struct(structName).fields[fieldName];
    if (!field || !Number.isInteger(field.offset) || !Number.isInteger(field.size)) {
      throw new Error(`libghostty type-layout JSON is missing ${structName}.${fieldName}`);
    }
    return field;
  }

  private setField(ptr: number, structName: string, fieldName: string, value: number): void {
    const field = this.field(structName, fieldName);
    switch (field.type) {
      case "bool":
      case "u8":
        new DataView(this.exports.memory.buffer).setUint8(ptr + field.offset, value);
        return;
      case "u16":
        new DataView(this.exports.memory.buffer).setUint16(ptr + field.offset, value, true);
        return;
      case "u32":
      case "enum":
        new DataView(this.exports.memory.buffer).setUint32(ptr + field.offset, value, true);
        return;
      case "u64":
        new DataView(this.exports.memory.buffer).setBigUint64(
          ptr + field.offset,
          BigInt(value),
          true,
        );
        return;
      default:
        throw new Error(`Unsupported libghostty field type ${field.type} at ${structName}.${fieldName}`);
    }
  }

  private readPointer(ptr: number): number {
    return this.readUnsigned(ptr, this.pointerSize);
  }

  private writePointer(ptr: number, value: number): void {
    this.writeUnsigned(ptr, this.pointerSize, value);
  }

  private readUnsigned(ptr: number, size: number): number {
    const view = new DataView(this.exports.memory.buffer);
    if (size === 4) return view.getUint32(ptr, true);
    throw new Error(`Unsupported libghostty integer size: ${size}`);
  }

  private writeUnsigned(ptr: number, size: number, value: number): void {
    const view = new DataView(this.exports.memory.buffer);
    if (size === 4) {
      view.setUint32(ptr, value, true);
      return;
    }
    throw new Error(`Unsupported libghostty integer size: ${size}`);
  }
}

class GhosttyTerminalImpl implements GhosttyTerminal {
  private runtime: GhosttyRuntime | null;
  private terminal: number;
  private formatter: number;

  constructor(runtime: GhosttyRuntime, handles: TerminalHandles) {
    this.runtime = runtime;
    this.terminal = handles.terminal;
    this.formatter = handles.formatter;
  }

  write(data: Uint8Array): void {
    const runtime = this.requireRuntime();
    if (!isUint8Array(data)) throw new TypeError("GhosttyTerminal.write expects Uint8Array");
    runtime.write(this.terminal, data);
  }

  resize(cols: number, rows: number): void {
    this.requireRuntime().resize(this.terminal, cols, rows);
  }

  reset(cols: number, rows: number): void {
    this.requireRuntime().reset(this.terminal, cols, rows);
  }

  formatHTML(): string {
    return this.requireRuntime().formatHTML(this.formatter);
  }

  dispose(): void {
    const runtime = this.runtime;
    if (runtime === null) return;

    // The formatter borrows the terminal and must be released first.
    runtime.exports.ghostty_formatter_free(this.formatter);
    runtime.exports.ghostty_terminal_free(this.terminal);
    this.formatter = 0;
    this.terminal = 0;
    this.runtime = null;
  }

  private requireRuntime(): GhosttyRuntime {
    if (this.runtime === null) throw new Error("GhosttyTerminal has been disposed");
    return this.runtime;
  }
}

/** Load the bundled WASM asset and create a terminal. */
export async function createGhosttyTerminal(
  cols: number,
  rows: number,
  options: GhosttyTerminalLoadOptions = {},
): Promise<GhosttyTerminal> {
  validateSize(cols, rows);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is unavailable; use createGhosttyTerminalFromWasm instead");
  }

  const response = await fetchImpl(options.wasmUrl ?? ghosttyWasmUrl);
  if (!response.ok) {
    throw new Error(`Failed to load libghostty WASM: ${response.status} ${response.statusText}`);
  }
  return createGhosttyTerminalFromWasm(await response.arrayBuffer(), cols, rows, options);
}

/**
 * Create a terminal from already-loaded bytes or a compiled module. This is
 * useful for tests and for hosts that cache one compiled module.
 */
export async function createGhosttyTerminalFromWasm(
  source: GhosttyWasmSource,
  cols: number,
  rows: number,
  options: GhosttyTerminalWasmOptions = {},
): Promise<GhosttyTerminal> {
  validateSize(cols, rows);
  const module = isWebAssemblyModule(source) ? source : await WebAssembly.compile(source);
  assertImportSurface(module);

  let memory: WebAssembly.Memory | null = null;
  const instance = await WebAssembly.instantiate(module, {
    env: {
      log: (ptr: number, len: number) => {
        // The pinned module has no start function, so memory is available by
        // the time logging can occur. Keep the guard for defensive embedders.
        if (memory === null || !options.log) return;
        const message = new TextDecoder().decode(new Uint8Array(memory.buffer, ptr, len));
        options.log(message);
      },
    },
  });
  const runtime = new GhosttyRuntime(instance);
  memory = runtime.exports.memory;
  return new GhosttyTerminalImpl(runtime, runtime.create(cols, rows));
}

function assertImportSurface(module: WebAssembly.Module): void {
  const imports = WebAssembly.Module.imports(module);
  if (
    imports.length !== 1 ||
    imports[0].module !== "env" ||
    imports[0].name !== "log" ||
    imports[0].kind !== "function"
  ) {
    const names = imports.map(({ module: namespace, name, kind }) => `${namespace}.${name}:${kind}`);
    throw new Error(`Unexpected libghostty WASM imports: ${names.join(", ") || "none"}`);
  }
}

function isWebAssemblyModule(value: unknown): value is WebAssembly.Module {
  try {
    // Module.imports performs the WebAssembly specification's internal-slot
    // brand check and works for modules created in another JavaScript realm.
    WebAssembly.Module.imports(value as WebAssembly.Module);
    return true;
  } catch {
    return false;
  }
}

function requireExports(exports: WebAssembly.Exports): GhosttyExports {
  const required = [
    "memory",
    "ghostty_type_json",
    "ghostty_alloc",
    "ghostty_free",
    "ghostty_wasm_alloc_opaque",
    "ghostty_wasm_free_opaque",
    "ghostty_wasm_alloc_u8_array",
    "ghostty_wasm_free_u8_array",
    "ghostty_wasm_alloc_usize",
    "ghostty_wasm_free_usize",
    "ghostty_terminal_new",
    "ghostty_terminal_free",
    "ghostty_terminal_reset",
    "ghostty_terminal_resize",
    "ghostty_terminal_vt_write",
    "ghostty_formatter_terminal_new",
    "ghostty_formatter_format_alloc",
    "ghostty_formatter_free",
  ] as const;

  for (const name of required) {
    const value = exports[name];
    if (name === "memory" ? !(value instanceof WebAssembly.Memory) : typeof value !== "function") {
      throw new Error(`libghostty WASM is missing required export ${name}`);
    }
  }
  return exports as unknown as GhosttyExports;
}

function validateSize(cols: number, rows: number): void {
  if (!Number.isInteger(cols) || cols < 1 || cols > 0xffff) {
    throw new RangeError("terminal columns must be an integer from 1 to 65535");
  }
  if (!Number.isInteger(rows) || rows < 1 || rows > 0xffff) {
    throw new RangeError("terminal rows must be an integer from 1 to 65535");
  }
}

function isUint8Array(value: unknown): value is Uint8Array {
  return ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === "[object Uint8Array]";
}

function assertSuccess(operation: string, result: number): void {
  if (result !== GHOSTTY_SUCCESS) throw new Error(`${operation} failed with result ${result}`);
}
