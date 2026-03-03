

## Problem

The current logic always jumps the playhead to `action.endTime` when selecting an action, showing the "after" screenshot. Now that the trace files contain both before and after screenshots aligned to `startTime` and `endTime`, the viewer should simply show whichever screenshot matches the playhead position — no special tolerance or preference logic needed.

## Plan

### Simplify `currentScreenshot` memo (~line 1062-1080)

Remove the special `nextAfter` / `activeAction` logic. Just find the latest screenshot with `time <= playhead`:

```javascript
const currentScreenshot = useMemo(() => {
  if (!traceData) return null;
  let best = null;
  for (const s of traceData.screenshots) {
    if (s.time <= playhead && s.url) best = s;
  }
  return best;
}, [playhead, traceData]);
```

This works because the trace now has a screenshot at `startTime` (before) and at `endTime` (after). When playhead is at `startTime`, the before screenshot is shown. When at `endTime`, the after screenshot is shown.

### Sidebar click: jump to `startTime` instead of `endTime`

On line 1471, change the click handler to jump to `startTime` so clicking an action shows the "before" state first. The user can then see the action's start state and use arrow keys or the timeline to advance to the end.

Actually — this changes the UX. Let me reconsider.

### Better approach: keep `endTime` navigation but make the screenshot logic straightforward

Since the trace now has properly timed before/after screenshots, the simple `time <= playhead` logic is sufficient. The playhead at `endTime` will pick up the "after" screenshot; if the user scrubs to `startTime`, they'll see the "before" screenshot. The timeline bar already shows the action span, so clicking the left edge vs right edge naturally shows different screenshots.

### Changes in `src/components/TraceStudio.jsx`:

**1. Simplify `currentScreenshot` memo (lines 1062-1080)**
Remove the `nextAfter`, `activeAction`, and 500ms tolerance logic. Return just the latest screenshot at or before the playhead. Remove `selectedAction` from the dependency array.

**2. No other changes needed**
The navigation already jumps to `endTime`, which shows the "after" screenshot. The timeline scrubbing naturally handles showing "before" at `startTime`. The overlay guard on line 1261 can stay as-is.

### Files
- `src/components/TraceStudio.jsx` — 1 edit (simplify screenshot memo)

