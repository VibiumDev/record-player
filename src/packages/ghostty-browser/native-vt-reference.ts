// Generated from Twee's native internal/vt adapter with the Ghostty revision
// pinned in build-info.json. Keep the event vector and selected native cell
// facts beside the browser differential test so the reference is independent
// of the TypeScript/WASM implementation under test.
export const nativeVTReference = {
  ghosttyRevision: "2ed382a15566b267c32fae440b065f7844b15bfb",
  initialCols: 8,
  initialRows: 3,
  events: [
    { time: 0, output: "plain" },
    { time: 10, output: "\r\n\u001b[1;3;4;5;31;44m界e\u0301\u001b[0m\u001b[?25l" },
    { time: 20, cols: 10, rows: 4 },
    { time: 30, output: "\u001b[?1049hALT" },
    { time: 40, output: "\u001b[?1049l" },
  ],
  checkpoints: [
    { time: 0, cols: 8, rows: 3, altScreen: false, lines: ["plain"] },
    { time: 10, cols: 8, rows: 3, altScreen: false, lines: ["plain", "界e\u0301"] },
    { time: 20, cols: 10, rows: 4, altScreen: false, lines: ["plain", "界e\u0301"] },
    { time: 30, cols: 10, rows: 4, altScreen: true, lines: ["", "   ALT"] },
    { time: 40, cols: 10, rows: 4, altScreen: false, lines: ["plain", "界e\u0301"] },
  ],
  selectedNativeCells: [
    {
      time: 10,
      row: 1,
      col: 0,
      text: "界",
      width: 2,
      foreground: { kind: "palette", index: 1 },
      background: { kind: "palette", index: 4 },
      bold: true,
      italic: true,
      underline: true,
    },
    {
      time: 10,
      row: 1,
      col: 2,
      text: "e\u0301",
      width: 1,
      foreground: { kind: "palette", index: 1 },
      background: { kind: "palette", index: 4 },
      bold: true,
      italic: true,
      underline: true,
    },
  ],
  complexWidthLines: [
    {
      input: "👍🏻x",
      cells: [{ text: "👍", width: 2 }, { text: "🏻", width: 2 }],
      followingColumn: 4,
    },
    {
      input: "🇺🇸x",
      cells: [{ text: "🇺", width: 2 }, { text: "🇸", width: 2 }],
      followingColumn: 4,
    },
    {
      input: "❤️x",
      cells: [{ text: "❤️", width: 1 }],
      followingColumn: 1,
    },
    {
      input: "1️⃣x",
      cells: [{ text: "1⃣", width: 1 }],
      followingColumn: 1,
    },
  ],
  nativeAttributeColors: {
    inverseRedOnBlue: {
      foreground: "rgb(24, 24, 178)",
      background: "rgb(178, 24, 24)",
    },
    faintRedOnBlue: {
      foreground: "rgb(89, 12, 12)",
      background: "rgb(24, 24, 178)",
    },
  },
} as const;
