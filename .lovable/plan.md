

## Problem

The action overlay (element highlight + cursor) appears immediately when an action is selected, but the screenshot lags behind because the `currentScreenshot` logic is too conservative -- it only considers screenshots within 100ms after the playhead. For actions where the result screenshot is recorded more than 100ms after `endTime`, the old screenshot persists for a beat while the overlay already shows the new action's target.

## Fix

Two changes in `src/components/TraceStudio.jsx`:

### 1. Widen the post-playhead screenshot tolerance

In the `currentScreenshot` memo (line 1062-1080), increase the 100ms tolerance to ~500ms, and make it prefer the nearest screenshot to the action's `endTime` regardless of whether it's before or after playhead, as long as it's within that window.

### 2. Sync the overlay guard with endTime

On line 1261, the overlay guard checks `Math.abs((selectedAction.startTime || 0) - playhead) < 350`. Since playhead now jumps to `endTime`, this check can fail for actions longer than 350ms, causing the overlay to flicker to `currentAction` instead. Change it to check against `endTime` as well: use `Math.min(startTime, endTime)` distance or simply widen the window to include both.

### Files
- `src/components/TraceStudio.jsx` -- 2 small edits

