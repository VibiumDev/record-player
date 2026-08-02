import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

import { createGhosttyTerminalFromWasm } from "../src/packages/ghostty-browser/index";

const limits = {
  wasmBytes: 600_000,
  wasmGzipBytes: 250_000,
  compileAndCreateMs: 1_500,
  replaySeekMs: 3_000,
  averageFormatMs: 100,
} as const;

const eventCount = 20_000;
const payload = new TextEncoder().encode(`${"x".repeat(63)}\n`);
const decodedOutputBytes = eventCount * payload.byteLength;
const wasm = await readFile(
  resolve(process.cwd(), "src/packages/ghostty-browser/assets/ghostty-vt.wasm"),
);

const loadStarted = performance.now();
const module = await WebAssembly.compile(wasm);
const terminal = await createGhosttyTerminalFromWasm(module, 120, 40);
const compileAndCreateMs = performance.now() - loadStarted;

const replay = () => {
  for (let index = 0; index < eventCount; index += 1) terminal.write(payload);
};

try {
  replay();
  terminal.formatHTML();

  const seekStarted = performance.now();
  terminal.reset(120, 40);
  replay();
  const replaySeekMs = performance.now() - seekStarted;

  const formatPasses = 20;
  const formatStarted = performance.now();
  let formattedBytes = 0;
  for (let index = 0; index < formatPasses; index += 1) {
    formattedBytes = terminal.formatHTML().length;
  }
  const averageFormatMs = (performance.now() - formatStarted) / formatPasses;
  const wasmGzipBytes = gzipSync(wasm, { level: 9 }).byteLength;

  const metrics = {
    workload: { eventCount, decodedOutputBytes, cols: 120, rows: 40 },
    assets: { wasmBytes: wasm.byteLength, wasmGzipBytes },
    timingsMs: {
      compileAndCreate: Number(compileAndCreateMs.toFixed(2)),
      replaySeek: Number(replaySeekMs.toFixed(2)),
      averageFormat: Number(averageFormatMs.toFixed(2)),
    },
    formattedBytes,
    limits,
    checkpointDecision: replaySeekMs <= limits.replaySeekMs
      ? "No checkpoints needed for the measured first-release workload"
      : "Add checkpoints before release",
  };

  console.log(JSON.stringify(metrics, null, 2));

  const failures = [
    ["raw WASM bytes", wasm.byteLength, limits.wasmBytes],
    ["gzip WASM bytes", wasmGzipBytes, limits.wasmGzipBytes],
    ["compile and create ms", compileAndCreateMs, limits.compileAndCreateMs],
    ["replay seek ms", replaySeekMs, limits.replaySeekMs],
    ["average format ms", averageFormatMs, limits.averageFormatMs],
  ].filter(([, actual, maximum]) => Number(actual) > Number(maximum));

  if (failures.length) {
    throw new Error(
      failures.map(([name, actual, maximum]) => `${name}: ${actual} exceeds ${maximum}`).join("; "),
    );
  }
} finally {
  terminal.dispose();
}
