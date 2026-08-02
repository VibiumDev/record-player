# ghostty-browser

Non-React browser bindings for the pinned `libghostty-vt` WebAssembly build.

`createGhosttyTerminal(cols, rows)` loads the colocated WASM asset through a
Vite-compatible `new URL(..., import.meta.url)` reference. Hosts that already
have bytes or a compiled `WebAssembly.Module` can use
`createGhosttyTerminalFromWasm` and reuse the compiled module across terminal
instances.

Native differential coverage and the repeatable high-volume performance gate
are documented in `../../../docs/twee-playback-verification.md`.

The bundled asset is built from Ghostty revision
`2ed382a15566b267c32fae440b065f7844b15bfb` with Zig 0.15.2. Its complete
provenance and digest are in `build-info.json`; Ghostty's required notice is in
`LICENSE.ghostty`. Normal application and package builds use the checked-in
asset and do not run Zig or download Ghostty.

To reproduce the checked-in asset, run `./build-ghostty-wasm.sh`. The script
checks the Zig version, fetches and checks out the pinned source revision in a
temporary directory, runs the documented Ghostty build, and verifies the exact
SHA-256 before replacing the asset.

Run `node ./verify-vite-output.mjs` from this directory to verify that the
custom-element build emits one external WASM file and that a nested bundle URL
resolves the relative reference to that colocated asset.
