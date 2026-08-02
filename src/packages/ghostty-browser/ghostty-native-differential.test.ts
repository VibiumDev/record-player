import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { createGhosttyTerminalFromWasm } from "./index";
import { nativeVTReference } from "./native-vt-reference";

const encoder = new TextEncoder();
let module: WebAssembly.Module;

beforeAll(async () => {
  const bytes = await readFile(
    resolve(process.cwd(), "src/packages/ghostty-browser/assets/ghostty-vt.wasm"),
  );
  module = await WebAssembly.compile(bytes);
});

function visibleLines(html: string): string[] {
  const text = new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
  const lines = text.split("\n").map((line) => line.trimEnd());
  while (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

describe("native Twee differential reference", () => {
  it("matches native visible text, resize, style, width, and active-screen checkpoints", async () => {
    expect(nativeVTReference.ghosttyRevision).toBe(
      "2ed382a15566b267c32fae440b065f7844b15bfb",
    );
    expect(nativeVTReference.selectedNativeCells).toMatchObject([
      { text: "界", width: 2, col: 0 },
      { text: "e\u0301", width: 1, col: 2 },
    ]);
    expect(nativeVTReference.complexWidthLines.map(({ followingColumn }) => followingColumn)).toEqual([4, 4, 1, 1]);
    expect(nativeVTReference.nativeAttributeColors).toEqual({
      inverseRedOnBlue: {
        foreground: "rgb(24, 24, 178)",
        background: "rgb(178, 24, 24)",
      },
      faintRedOnBlue: {
        foreground: "rgb(89, 12, 12)",
        background: "rgb(24, 24, 178)",
      },
    });

    const terminal = await createGhosttyTerminalFromWasm(
      module,
      nativeVTReference.initialCols,
      nativeVTReference.initialRows,
    );
    try {
      for (const event of nativeVTReference.events) {
        if ("output" in event) terminal.write(encoder.encode(event.output));
        else terminal.resize(event.cols, event.rows);

        const checkpoint = nativeVTReference.checkpoints.find(({ time }) => time === event.time);
        expect(checkpoint, `native checkpoint at ${event.time}ms`).toBeDefined();
        const html = terminal.formatHTML();
        expect(visibleLines(html), `visible screen at ${event.time}ms`).toEqual(checkpoint?.lines);

        if (event.time === 10) {
          expect(html).toContain("font-weight: bold");
          expect(html).toContain("font-style: italic");
          expect(html).toContain("text-decoration-line: underline blink");
          expect(html).toMatch(/color: var\(--vt-palette-(1|9)\)/);
          expect(html).toContain("background-color: var(--vt-palette-4)");
        }
        if (checkpoint?.altScreen) {
          expect(html).toContain("ALT");
          expect(html).not.toContain("plain");
        }
      }
    } finally {
      terminal.dispose();
    }
  });
});
