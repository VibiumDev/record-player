import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

import { beforeAll, describe, expect, it } from "vitest";

import {
  createGhosttyTerminal,
  createGhosttyTerminalFromWasm,
  ghosttyWasmUrl,
  type GhosttyTerminal,
} from "./index";

const encoder = new TextEncoder();
let module: WebAssembly.Module;

beforeAll(async () => {
  const bytes = await readFile(assetPath("assets/ghostty-vt.wasm"));
  module = await WebAssembly.compile(bytes);
});

async function terminal(cols = 12, rows = 4): Promise<GhosttyTerminal> {
  return createGhosttyTerminalFromWasm(module, cols, rows);
}

describe("Ghostty browser terminal lifecycle", () => {
  it("creates, writes, formats, resizes, and resets a real terminal", async () => {
    const term = await terminal(4, 2);
    try {
      term.write(encoder.encode("abcdef"));
      expect(formattedText(term.formatHTML())).toBe("abcd\nef");

      term.resize(8, 2);
      expect(formattedText(term.formatHTML())).toBe("abcdef");

      term.reset(3, 2);
      expect(formattedText(term.formatHTML())).not.toContain("abcdef");
      term.write(encoder.encode("123456"));
      expect(formattedText(term.formatHTML())).toBe("123\n456");
    } finally {
      term.dispose();
    }
  });

  it("loads bytes through the Vite-compatible asset URL", async () => {
    const bytes = await readFile(assetPath("assets/ghostty-vt.wasm"));
    const requested: Array<string | URL> = [];
    const fetchStub = async (input: string | URL | Request) => {
      requested.push(input as string | URL);
      return new Response(bytes, { status: 200 });
    };

    const term = await createGhosttyTerminal(10, 2, { fetch: fetchStub, wasmUrl: ghosttyWasmUrl });
    try {
      expect(requested).toEqual([ghosttyWasmUrl]);
      term.write(encoder.encode("loaded"));
      expect(term.formatHTML()).toContain("loaded");
    } finally {
      term.dispose();
    }
  });

  it("disposes idempotently and rejects every later operation", async () => {
    const term = await terminal();
    term.dispose();
    term.dispose();

    expect(() => term.write(encoder.encode("late"))).toThrow(/disposed/);
    expect(() => term.resize(80, 24)).toThrow(/disposed/);
    expect(() => term.reset(80, 24)).toThrow(/disposed/);
    expect(() => term.formatHTML()).toThrow(/disposed/);
  });

  it("validates dimensions and binary writes at the API boundary", async () => {
    await expect(createGhosttyTerminalFromWasm(module, 0, 2)).rejects.toThrow(/columns/);
    await expect(createGhosttyTerminalFromWasm(module, 2, 65_536)).rejects.toThrow(/rows/);

    const term = await terminal();
    try {
      expect(() => term.resize(1.5, 2)).toThrow(/columns/);
      expect(() => term.write("text" as unknown as Uint8Array)).toThrow(/Uint8Array/);
      expect(() => term.write(new Uint8Array())).not.toThrow();
    } finally {
      term.dispose();
    }
  });

  it("bundles a module whose only host capability is env.log", () => {
    expect(WebAssembly.Module.imports(module)).toEqual([
      { module: "env", name: "log", kind: "function" },
    ]);
  });

  it("accepts a compiled module created in another JavaScript realm", async () => {
    const bytes = await readFile(assetPath("assets/ghostty-vt.wasm"));
    const foreignModule = runInNewContext("new WebAssembly.Module(bytes)", {
      bytes,
    }) as WebAssembly.Module;

    expect(foreignModule).not.toBeInstanceOf(WebAssembly.Module);
    const term = await createGhosttyTerminalFromWasm(foreignModule, 8, 2);
    try {
      term.write(encoder.encode("foreign"));
      expect(formattedText(term.formatHTML())).toBe("foreign");
    } finally {
      term.dispose();
    }
  });

  it("matches the pinned asset provenance metadata", async () => {
    const bytes = await readFile(assetPath("assets/ghostty-vt.wasm"));
    const metadata = JSON.parse(
      await readFile(assetPath("build-info.json"), "utf8"),
    ) as { ghosttyRevision: string; zigVersion: string; wasmBytes: number; wasmSha256: string };

    expect(metadata.ghosttyRevision).toBe("2ed382a15566b267c32fae440b065f7844b15bfb");
    expect(metadata.zigVersion).toBe("0.15.2");
    expect(bytes.byteLength).toBe(metadata.wasmBytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(metadata.wasmSha256);
  });
});

function assetPath(name: string): string {
  return resolve(process.cwd(), "src/packages/ghostty-browser", name);
}

function formattedText(html: string): string {
  return new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
}
