import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { createGhosttyTerminalFromWasm, type GhosttyTerminal } from "./index";

const encoder = new TextEncoder();
let module: WebAssembly.Module;

beforeAll(async () => {
  const bytes = await readFile(
    resolve(process.cwd(), "src/packages/ghostty-browser/assets/ghostty-vt.wasm"),
  );
  module = await WebAssembly.compile(bytes);
});

async function terminal(cols = 40, rows = 4): Promise<GhosttyTerminal> {
  return createGhosttyTerminalFromWasm(module, cols, rows);
}

describe("Ghostty VT conformance smoke coverage", () => {
  it("formats ANSI colors, bold, and underline as HTML", async () => {
    const term = await terminal();
    try {
      term.write(encoder.encode("\u001b[1;4;5;31mstyled\u001b[0m"));
      const html = term.formatHTML();

      expect(html).toContain("styled");
      expect(html).toContain("font-weight: bold");
      expect(html).toContain("text-decoration-line: underline blink");
      expect(html).toMatch(/var\(--vt-palette-(1|9)\)/);
      expect(html).toContain("--vt-palette-1:");
    } finally {
      term.dispose();
    }
  });

  it("reports inverse and faint formatter styles", async () => {
    const term = await terminal();
    try {
      term.write(encoder.encode("\u001b[31;44;7mI\u001b[0m\u001b[31;44;2mD\u001b[0m"));
      const html = term.formatHTML();
      expect(html).toContain('filter: invert(100%);">I');
      expect(html).toContain('opacity: 0.5;">D');
    } finally {
      term.dispose();
    }
  });

  it("preserves Unicode, wide characters, and combining characters", async () => {
    const term = await terminal();
    try {
      const text = "ASCII 🙂 界 e\u0301";
      term.write(encoder.encode(text));
      expect(formattedText(term.formatHTML())).toBe(text);
    } finally {
      term.dispose();
    }
  });

  it("keeps trailing spaces and soft-wrapped lines", async () => {
    const term = await terminal(4, 3);
    try {
      term.write(encoder.encode("ab  cdef"));
      expect(formattedText(term.formatHTML())).toBe("ab  \ncdef");
    } finally {
      term.dispose();
    }
  });

  it("tracks alternate-screen state and restores primary-screen content", async () => {
    const term = await terminal();
    try {
      term.write(encoder.encode("primary"));
      term.write(encoder.encode("\u001b[?1049hALT"));
      expect(term.formatHTML()).toContain("ALT");
      expect(term.formatHTML()).not.toContain("primary");

      term.write(encoder.encode("\u001b[?1049l"));
      expect(term.formatHTML()).toContain("primary");
      expect(term.formatHTML()).not.toContain("ALT");
    } finally {
      term.dispose();
    }
  });

  it("produces the same screen for every two-part byte split", async () => {
    const sequence = encoder.encode(
      "start \u001b[1;34mblue🙂e\u0301\u001b[0m\r\n\u001b[2;5Hdone",
    );
    const baselineTerminal = await terminal();
    baselineTerminal.write(sequence);
    const baseline = baselineTerminal.formatHTML();
    baselineTerminal.dispose();

    for (let split = 0; split <= sequence.byteLength; split += 1) {
      const term = await terminal();
      try {
        term.write(sequence.subarray(0, split));
        term.write(sequence.subarray(split));
        expect(term.formatHTML(), `split at byte ${split}`).toBe(baseline);
      } finally {
        term.dispose();
      }
    }
  });

  it("HTML-escapes hostile text and represents OSC 8 link data", async () => {
    const term = await terminal();
    try {
      term.write(encoder.encode("<script>alert('no')</script>"));
      term.write(encoder.encode("\r\n\u001b]8;;https://example.test/\u001b\\linked\u001b]8;;\u001b\\"));
      const html = term.formatHTML();

      expect(html).toContain("&lt;script&gt;");
      expect(html).not.toContain("<script>alert");
      expect(html).toContain('<a href="https://example.test/">linked</a>');
    } finally {
      term.dispose();
    }
  });
});

function formattedText(html: string): string {
  return new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
}
