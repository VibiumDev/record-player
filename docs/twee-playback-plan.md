# Plan: Play Twee Recordings with libghostty WASM

## 1. Purpose

Add support for Twee terminal recordings to Record Player.

Record Player must continue to play Vibium browser recordings. It must also open and play `.twee` files.

The first implementation will run fully in the browser. Record Player will not upload a recording to a server.

## 2. Primary design

Use the Ghostty terminal engine for Twee playback. Compile the Ghostty VT library to WebAssembly (WASM).

Use the same Ghostty source revision that Twee uses. The baseline revision is `2ed382a15566b267c32fae440b065f7844b15bfb`.

Use the Ghostty HTML formatter for the first terminal view. The formatter supplies text, colors, and text styles.

Keep the Ghostty render-state API as the second terminal view. Use this API if the HTML formatter fails the Phase 1 limits or differential tests.

Do not use xterm.js in the primary design. A second terminal engine can give different results for the same VT data.

## 3. Reasons for this design

Ghostty has a browser WASM example. The example does these tasks:

- It loads `ghostty-vt.wasm`.
- It reads C structure layouts from `ghostty_type_json`.
- It creates and resizes a terminal.
- It writes VT data to the terminal.
- It reads formatted terminal content.

The WASM build also exports the Ghostty render-state API. This API supplies rows, cells, graphemes, styles, colors, and cursor data.

Twee already uses the same render-state API through Go bindings. Thus, the browser and native players can use the same terminal rules.

## 4. Recording model

Add a format value to the common recording model.

```ts
type RecordingDocument = VibiumRecording | TweeRecording;

interface VibiumRecording extends RecordingBase {
  format: "vibium";
  presentation: ScreenshotPresentation;
}

interface TweeRecording extends RecordingBase {
  format: "twee";
  presentation: TerminalPresentation;
  manifest: TweeManifest;
  terminalEvents: TweeEvent[];
}
```

Keep common data in `RecordingBase`. Common data includes the source, duration, event list, and file list.

Keep format data in each format type. Do not add empty screenshot fields to a Twee recording. Do not add empty terminal fields to a Vibium recording.

Use the format value to select the correct view. A Vibium recording uses a screenshot view. A Twee recording uses a terminal view.

## 5. Data flow

```text
Recording ZIP
    |
    v
Format detector
    |
    +---- Vibium parser ----> screenshot presentation
    |
    +---- Twee parser ------> terminal events
                                  |
                                  v
                          libghostty WASM
                                  |
                                  v
                          Ghostty HTML output
                                  |
                                  v
                           terminal presentation

Common playback clock ----> selected presentation
```

The common playback clock controls play, pause, and seek operations. Each presentation decides how to show the selected time.

## 6. Twee file parser

Add a Twee parser to `player-core`.

Detect the format from files in the ZIP archive. Do not depend only on the file name extension.

A Twee version 1 recording must contain these files:

- `manifest.json`
- `events.jsonl`

The parser must validate `manifest.version`. The first release will accept version 1 only.

The parser must read these manifest values:

- Command
- Initial columns and rows
- Start and stop times
- Host data
- Process ID
- Environment data, when present

The parser must read events in file order. Events with the same `t_ms` value must keep their file order.

The parser must support these event types:

- `output`: Decode `bytes_b64`. Send the bytes to Ghostty.
- `resize`: Change the Ghostty terminal size.
- `input`: Show the input on the timeline. Do not send the input bytes to Ghostty.
- `exit`: Show the exit code on the timeline.

The parser must reject invalid JSON, invalid Base64 data, invalid terminal sizes, and unknown recording versions.

Define limits for ZIP size, expanded file size, event count, terminal size, and event payload size. Apply the limits before large allocations.

## 7. Ghostty WASM asset

Build the WASM file with the Ghostty build command:

```sh
zig build -Demit-lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall
```

Add a repeatable build script. Pin the Ghostty revision and the Zig version in that script.

Store the generated WASM file with the reusable player package. A normal Record Player build must not download Ghostty or require Zig.

Store the following build data with the WASM file:

- Ghostty source revision
- Zig version
- WASM SHA-256 value
- Required license notices

Make Vite emit the WASM file as a package asset. Load the file with a URL that also works in the reusable React and custom-element builds.

## 8. TypeScript Ghostty wrapper

Add a separate package for the Ghostty browser API. The package must not contain React code.

The first public interface must supply these operations:

```ts
interface GhosttyTerminal {
  write(data: Uint8Array): void;
  resize(cols: number, rows: number): void;
  reset(cols: number, rows: number): void;
  formatHTML(): string;
  dispose(): void;
}
```

Use `ghostty_type_json` to find C field offsets. Do not put target-specific structure offsets in TypeScript.

Copy input bytes into WASM memory before each write. Release each temporary allocation after the call.

Release the terminal, formatter, and WASM allocations in `dispose()`.

The first version must import `env.log` only. Do not give the module network, storage, clipboard, or navigation access.

## 9. Terminal view

Create a `TerminalPresentation` component.

Use the Ghostty formatter with these display rules:

- Keep soft-wrapped lines wrapped.
- Keep trailing spaces.
- Use a fixed-width font.
- Use a fixed line height.
- Update the viewport after a resize event.
- Format the terminal no more than once in one animation frame.

Do not insert formatter output directly into the document.

Parse the formatter output. Rebuild an allowed set of elements and styles. Remove links and all event attributes in the first release.

Use a private style scope for terminal CSS. The terminal styles must not change Record Player styles.

Package the terminal fonts that the design requires. Prefer the fonts that Twee uses for its image output.

## 10. Playback and seek behavior

Create one Ghostty terminal when a Twee recording opens. Use the initial size from the manifest.

For forward playback, apply each due `output` and `resize` event. Apply events in file order.

Process all events for the current animation frame. Format the terminal once after those events.

For a backward seek, reset the terminal to its initial size. Replay events from the start to the target time.

Use the same reset operation when the user restarts playback.

Do not make terminal checkpoints in the first release. The Ghostty C API does not supply a complete terminal clone operation.

Add a high-volume recording benchmark. Record the event count and decoded output size. Use the result to decide if a later release needs checkpoints.

## 11. User interface changes

Use one file-open action for both formats. Accept `.zip` and `.twee` files.

Show the detected format near the recording name.

For a Twee recording, show these items:

- Terminal view
- Command
- Terminal size
- Duration
- Input events
- Resize events
- Exit event and exit code

Keep the common play, pause, timeline, and seek controls.

Do not show browser-only panels for a Twee recording. These panels include screenshots, network data, console data, and DOM data.

Keep all current Vibium behavior.

## 12. Test plan

### 12.1 Parser tests

Add tests for these inputs:

- Valid Twee version 1 file
- Missing manifest
- Missing event file
- Unsupported version
- Invalid JSON line
- Invalid Base64 data
- Invalid terminal size
- Events with equal times
- Empty recording
- File that exceeds a defined limit

### 12.2 Ghostty wrapper tests

Test terminal creation, write, resize, reset, format, and disposal.

Test plain text, ANSI colors, bold text, underline text, Unicode text, wide characters, combining characters, and alternate-screen data.

Split the same VT byte sequence at different byte positions. Each split must give the same final screen.

### 12.3 Differential tests

Use the native Twee player as the reference.

For each test recording, select a set of event times. Compare the browser screen with the native Twee snapshot at each time.

Compare these values first:

- Rows and columns
- Visible text
- Character width
- Text style
- Foreground and background colors
- Active screen

Add image comparisons for selected recordings. Define the permitted pixel difference in the test configuration. Do not permit different text or cell positions.

### 12.4 Playback tests

Verify these sequences:

- Play from start to end.
- Pause and continue.
- Seek forward.
- Seek backward.
- Seek many times in quick succession.
- Resize during playback.
- Open a second recording while the first recording plays.

The screen at a selected time must not depend on the path used to reach that time.

### 12.5 Regression tests

Run all current Vibium tests. Add one full Vibium playback test after the common model changes.

Run a production build. Verify that the build includes the WASM file and all required fonts.

## 13. Delivery phases

### Phase 1: Technical proof

1. Build the pinned Ghostty revision for WASM.
2. Load the WASM file from the Vite application.
3. Open one real `.twee` file.
4. Apply `output` and `resize` events.
5. Show Ghostty HTML output.
6. Define pass limits for WASM size, load time, seek time, and format time.
7. Measure each value against its pass limit.
8. Test hostile text and OSC 8 link data.

Continue with the HTML formatter if it passes the performance limits and differential tests.

### Phase 2: Common recording model

1. Add the format-specific recording types.
2. Move current Vibium parsing behind the Vibium adapter.
3. Add ZIP format detection.
4. Add the Twee parser and parser tests.
5. Keep the current Vibium fields and exports during this phase.

### Phase 3: Terminal playback

1. Add the TypeScript Ghostty wrapper.
2. Add the terminal playback session.
3. Add the safe HTML terminal view.
4. Connect the view to the common playback clock.
5. Add play, pause, and seek tests.

### Phase 4: Product integration

1. Add Twee metadata and timeline event labels.
2. Hide browser-only panels for Twee recordings.
3. Support drag-and-drop, file selection, URL loading, React, and the custom element.
4. Add accessibility labels and keyboard tests.

### Phase 5: Verification and release

1. Run differential tests against native Twee.
2. Run the large-recording benchmark.
3. Run all Vibium regression tests.
4. Record the compressed WASM and font sizes.
5. Add build and license data to the release package.
6. Update the user documentation.

## 14. Decision point for the terminal view

Keep the HTML formatter if it meets all acceptance conditions.

Use the render-state API and a Canvas view if one of these conditions occurs:

- HTML formatting is too slow.
- HTML does not keep the correct cell layout.
- Safe HTML filtering removes required terminal data.
- The design needs cursor, selection, or dirty-row control.

The render-state view will use the same Ghostty terminal instance. It will not change the recording parser or playback clock.

If profiling shows that JavaScript and WASM calls are the main delay, add one Zig export. The export will copy one complete screen into one linear memory buffer.

## 15. First-release exclusions

The first release will not supply these functions:

- Live terminal input
- Terminal process control
- Clipboard operations
- Active hyperlinks
- Full scrollback browsing
- Ghostty image protocol display
- Terminal state checkpoints
- Server-side recording conversion

These exclusions do not change the `.twee` file format.

## 16. Acceptance conditions

The work is complete when all these conditions are true:

- Record Player detects and opens a valid Twee version 1 recording.
- Record Player still opens current Vibium recordings.
- Twee output and resize events produce the same visible screen as native Twee.
- Play, pause, forward seek, and backward seek work.
- Input, resize, and exit events appear at the correct timeline times.
- A Twee recording does not open a browser-only panel.
- Formatter output cannot add scripts, event handlers, or active links.
- The production build contains a reproducible, pinned WASM asset.
- The React API and the custom element can load both recording formats.
- All parser, playback, differential, security, and regression tests pass.

## 17. Main risks and controls

| Risk | Control |
| --- | --- |
| The WASM file exceeds its size limit. | Use `ReleaseSmall`. Measure compressed size in Phase 1. Load the file only for Twee recordings. |
| HTML formatting exceeds its time limit. | Format once per animation frame. Change to the render-state API if necessary. |
| Formatter HTML contains unsafe data. | Parse the output. Use an element and style allowlist. Remove active links. |
| Backward seek is slow. | Reset and replay first. Measure large recordings before checkpoint work. |
| Browser output differs from native Twee. | Pin the same Ghostty revision. Run differential tests at event times. |
| Ghostty changes its C API. | Pin the source revision. Use generated type layout data. Update the wrapper and WASM together. |
| The common model breaks Vibium playback. | Use a format union. Keep format data separate. Run all Vibium tests. |
| A recording uses too much memory. | Set archive, event, payload, and terminal-size limits. Reject files that exceed the limits. |

## 18. Technical references

- [Ghostty WASM VT example](https://github.com/ghostty-org/ghostty/tree/2ed382a15566b267c32fae440b065f7844b15bfb/example/wasm-vt)
- [Ghostty WASM browser code](https://github.com/ghostty-org/ghostty/blob/2ed382a15566b267c32fae440b065f7844b15bfb/example/wasm-vt/index.html)
- [Ghostty WASM exports](https://github.com/ghostty-org/ghostty/blob/2ed382a15566b267c32fae440b065f7844b15bfb/src/lib_vt.zig)
- [Ghostty formatter API](https://github.com/ghostty-org/ghostty/blob/2ed382a15566b267c32fae440b065f7844b15bfb/include/ghostty/vt/formatter.h)
- [Ghostty render-state API](https://github.com/ghostty-org/ghostty/blob/2ed382a15566b267c32fae440b065f7844b15bfb/include/ghostty/vt/render.h)
- Twee trace format: `internal/trace/trace.go`
- Twee trace reader: `internal/tracebundle/bundle.go`
- Twee Ghostty adapter: `internal/vt/ghostty.go`
