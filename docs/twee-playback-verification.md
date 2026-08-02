# Twee playback verification

## Native differential reference

`ghostty-native-differential.test.ts` replays one event vector through the
browser WASM wrapper and compares every checkpoint with a golden produced by
Twee's native `internal/vt` adapter. Both paths use Ghostty revision
`2ed382a15566b267c32fae440b065f7844b15bfb`.

The checkpoints cover primary and alternate screens, resize, visible text,
ANSI foreground/background colors, bold, italic, underline/blink, a width-2
CJK cell, and a combining grapheme. Text and checkpoint positions permit no
difference.

`npm run test:visual` serves the test harness locally and loads the production
React renderer, real Ghostty WASM, and packaged fonts in headless Chromium.
It asserts the native 8 x 20 cell grid, width-2 CJK placement, combining-mark
placement, modifier and regional-indicator widths, variation/keycap widths,
palette colors, inverse/faint semantics, and text decoration before comparing the 64 x 60
terminal capture to `src/test/visual/native-twee-styled.png`. That PNG was
rendered by Twee's native `internal/vt` and `internal/render` packages at the
same Ghostty revision. The declared comparison limits are a per-pixel color
threshold of 0.15 and a maximum differing-pixel ratio of 0.06; text, geometry,
computed colors, and computed styles still require exact or 0.1px-tolerance
matches. The native complex-width golden expects following columns 4, 4, 1,
and 1 for modifier, flag, heart-variation, and keycap examples respectively.
The browser gate also verifies Space/Enter playback activation and arrow-key
range seeking.

## Phase 1 performance limits

Run:

```sh
npm run benchmark:twee
```

The benchmark is a deterministic 20,000-event, 1,280,000-byte decoded output
stream at 120 x 40 cells. It measures a cold compile/create, full reset/replay
seek, and twenty HTML formatting passes. It fails if any of these first-release
limits are exceeded:

| Measurement | Limit |
| --- | ---: |
| Raw WASM | 600,000 bytes |
| gzip -9 WASM | 250,000 bytes |
| Compile and create | 1,500 ms |
| Reset and full replay | 3,000 ms |
| Average HTML format | 100 ms |

Measured on the exe.dev delivery VM on 2026-07-31:

| Measurement | Result |
| --- | ---: |
| Events | 20,000 |
| Decoded output | 1,280,000 bytes |
| Raw WASM | 555,074 bytes |
| gzip -9 WASM | 158,887 bytes |
| Compile and create | 153.81 ms |
| Reset and full replay | 36.65 ms |
| Average HTML format | 0.25 ms |

The measured seek is far below the first-release limit, so terminal
checkpoints are not needed for this workload. Re-run the benchmark on release
hardware before changing that decision.

## Packaged visual assets

The browser presentation uses the same 14px JetBrains Mono face and Noto
fallback set as Twee's native renderer. Its 8 x 20 cell metrics and default
black / `#c8c8c8` colors are set in the terminal component. Font licenses are
stored beside the font files under `src/packages/player-react/fonts`.
