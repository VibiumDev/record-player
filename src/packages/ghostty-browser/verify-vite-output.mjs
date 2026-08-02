import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build, loadConfigFromFile, mergeConfig } from "vite";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(packageDir, "../../..");
const metadata = JSON.parse(readFileSync(path.join(packageDir, "build-info.json"), "utf8"));
const environment = { command: "build", mode: "production" };
const loaded = await loadConfigFromFile(
  environment,
  path.join(repositoryRoot, "vite.element.config.ts"),
);
if (!loaded) throw new Error("failed to load vite.element.config.ts");

const result = await build(
  mergeConfig(loaded.config, {
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      rollupOptions: {
        // Make the Ghostty package reachable while retaining the real element
        // plugins and put the JS entry below the package output root.
        input: path.join(packageDir, "index.ts"),
        output: {
          format: "es",
          entryFileNames: "nested/vibium-record-player.js",
        },
      },
    },
  }),
);

const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) => item.output);
const wasmAssets = outputs.filter(
  (item) => item.type === "asset" && item.fileName.endsWith(".wasm"),
);
if (wasmAssets.length !== 1) {
  throw new Error(`expected one emitted WASM asset, found ${wasmAssets.length}`);
}

const wasmBytes = Buffer.from(wasmAssets[0].source);
const digest = createHash("sha256").update(wasmBytes).digest("hex");
if (wasmBytes.byteLength !== metadata.wasmBytes || digest !== metadata.wasmSha256) {
  throw new Error(`emitted WASM does not match metadata: ${wasmBytes.byteLength} bytes, ${digest}`);
}

const chunks = outputs.filter((item) => item.type === "chunk");
if (chunks.length !== 1) throw new Error(`expected one JS chunk, found ${chunks.length}`);
if (chunks[0].code.includes("data:application/wasm")) {
  throw new Error("element JavaScript contains an inlined WASM data URI");
}

const assetBaseName = path.posix.basename(wasmAssets[0].fileName);
const escapedBaseName = assetBaseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const match = chunks[0].code.match(new RegExp(`["']([^"'\\n]*${escapedBaseName})["']`));
if (!match) throw new Error("element JavaScript does not reference the emitted WASM asset");
if (match[1].startsWith("/")) throw new Error(`WASM URL is root-relative: ${match[1]}`);

const packageBaseUrl = "https://cdn.example.test/packages/record-player/v1/";
const bundleUrl = new URL(chunks[0].fileName, packageBaseUrl);
const expectedAssetUrl = new URL(wasmAssets[0].fileName, packageBaseUrl);
const resolvedAssetUrl = new URL(match[1], bundleUrl);
if (resolvedAssetUrl.href !== expectedAssetUrl.href) {
  throw new Error(
    `nested bundle resolves WASM to ${resolvedAssetUrl.href}, expected ${expectedAssetUrl.href}`,
  );
}

console.log(
  `verified ${chunks[0].fileName} -> ${match[1]} -> ${wasmAssets[0].fileName} ` +
    `(${wasmBytes.byteLength} bytes, ${digest})`,
);
