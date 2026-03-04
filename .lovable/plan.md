

## Plan: Use screencast-frame dimensions as default viewport

### Problem
When trace files lack `frame-snapshot` data, there's no viewport information available for coordinate normalization. The screencast-frame events already contain `width` and `height` fields that represent the viewport dimensions, but these aren't being used as a viewport fallback.

### Changes (single file: `src/components/TraceStudio.jsx`)

1. **Extract viewport from screencast-frame data in `processTraceEvents`**: After processing all events, if no `contextOptions.viewport` was found, derive a default viewport from the first screencast-frame's `width`/`height`. Return this as a `fallbackViewport` in the parsed result.

2. **Pass screencast-frame dimensions as viewport fallback**: In the rendering code where `viewport` is passed to `ActionOverlay` and `PersistentCursor` (~lines 1401-1402), use `currentScreenshot` width/height as a fallback when `traceData?.contextOptions?.options?.viewport` is null:
   ```
   viewport = traceData?.contextOptions?.options?.viewport 
     || { width: currentScreenshot?.width, height: currentScreenshot?.height }
   ```

3. **Per-screenshot viewport in normalization**: Since each screencast-frame can have different dimensions, the `currentScreenshot.width`/`height` should be preferred over a single global viewport. This means the `screenshot` object already carries the right data — we just need to add it as a candidate viewport in `normalizeActionCoords` when no snapshot viewport exists.

### Technical detail
In `normalizeActionCoords`, add a candidate using `screenshot.width`/`screenshot.height` as a viewport-like coordinate base (not just as raw screenshot dimensions) when `snapshotViewport` is null. This gives the penalty system a direct match for traces where coordinates are in viewport space matching the screencast frame size.

