import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";
import { emitTweeReleaseAssets } from "./vite.release-assets";

const ghosttyPackageDir = path.resolve(__dirname, "src/packages/ghostty-browser");
const ghosttyBuildInfo = JSON.parse(
  readFileSync(path.join(ghosttyPackageDir, "build-info.json"), "utf8"),
) as { wasmBytes: number; wasmFile: string; wasmSha256: string };

function emitAndVerifyGhosttyWasm(): Plugin {
  const source = readFileSync(path.join(ghosttyPackageDir, ghosttyBuildInfo.wasmFile));

  return {
    name: "emit-and-verify-ghostty-wasm",
    buildStart() {
      this.emitFile({ type: "asset", name: "ghostty-vt.wasm", source });
    },
    generateBundle(_outputOptions, bundle) {
      const wasmAssets = Object.values(bundle).filter(
        (entry) => entry.type === "asset" && entry.fileName.endsWith(".wasm"),
      );
      if (wasmAssets.length !== 1) {
        this.error(`expected one Ghostty WASM asset, found ${wasmAssets.length}`);
      }

      const wasmAsset = wasmAssets[0];
      if (wasmAsset.type !== "asset") {
        this.error("expected Ghostty WASM bundle entry to be an asset");
        return;
      }
      const wasmSource = wasmAsset.source;
      const wasmBytes = Buffer.from(
        typeof wasmSource === "string" ? new TextEncoder().encode(wasmSource) : wasmSource,
      );
      if (wasmBytes.byteLength !== ghosttyBuildInfo.wasmBytes) {
        this.error(
          `Ghostty WASM size mismatch: expected ${ghosttyBuildInfo.wasmBytes}, got ${wasmBytes.byteLength}`,
        );
      }
      const digest = createHash("sha256").update(wasmBytes).digest("hex");
      if (digest !== ghosttyBuildInfo.wasmSha256) {
        this.error(
          `Ghostty WASM digest mismatch: expected ${ghosttyBuildInfo.wasmSha256}, got ${digest}`,
        );
      }

      const wasmFileName = wasmAsset.fileName;
      const wasmBaseName = path.posix.basename(wasmFileName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const wasmReference = new RegExp(`(["'])([^"'\\n]*${wasmBaseName})\\1`, "g");
      for (const entry of Object.values(bundle)) {
        if (entry.type !== "chunk") continue;
        if (entry.code.includes("data:application/wasm")) {
          this.error(`Ghostty WASM was inlined in ${entry.fileName}`);
        }

        for (const match of entry.code.matchAll(wasmReference)) {
          const reference = match[2];
          if (reference.startsWith("/")) {
            this.error(`Ghostty WASM uses a root-relative URL in ${entry.fileName}: ${reference}`);
          }
          const resolved = path.posix.normalize(
            path.posix.join(path.posix.dirname(entry.fileName), reference),
          );
          if (resolved !== wasmFileName) {
            this.error(
              `Ghostty WASM URL in ${entry.fileName} resolves to ${resolved}, expected ${wasmFileName}`,
            );
          }
        }
      }
    },
  };
}

export default defineConfig({
  // Keep runtime asset URLs relative to the element bundle so the package can
  // be served from a CDN or application subpath rather than only site root.
  base: "./",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  plugins: [react(), emitAndVerifyGhosttyWasm(), emitTweeReleaseAssets(__dirname)],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // The element bundle ships only the compiled component, not the hosted
    // app's demo recordings under public/.
    copyPublicDir: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: path.resolve(__dirname, "src/packages/player-element/register.ts"),
      output: {
        format: "es",
        entryFileNames: "vibium-record-player.js",
      },
    },
    outDir: "dist-element",
    emptyOutDir: true,
  },
});
