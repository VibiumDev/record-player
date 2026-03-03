

## Problem

When clicking an action in the sidebar, the playhead jumps to `action.startTime` (line 1460). The screenshot picker (line 1062-1069) then shows the latest screencast frame with `time <= playhead`. Since screencast frames capturing the *result* of an action are recorded **after** the action completes (`endTime`), the displayed screenshot is always one from *before* the action — showing the wrong state.

This creates the "off by a step or two" effect: the fill result screenshot only appears when the playhead reaches a later action whose `startTime` exceeds the fill's screencast frame timestamp.

**This is a viewer bug, not a trace recording issue.**

## Fix

Two changes needed:

### 1. Action click → jump to `endTime` instead of `startTime`

When clicking an action in the sidebar (line 1460) and in arrow key navigation (lines 1026, 1037), set playhead to `action.endTime` (falling back to `startTime`). This ensures the post-action screenshot is displayed, showing what happened *as a result* of that action.

Apply the same change to:
- Sidebar action click (line 1460)
- Arrow key prev/next (lines 1026, 1037)
- Mobile prev/next buttons (lines 1173, 1175)
- Swipe navigation (lines 1222, 1228)

### 2. `currentScreenshot` — prefer the nearest post-action frame when an action is active

Update the `currentScreenshot` memo to also consider the *next* screenshot after the playhead when the current/selected action's `endTime` is very close to a screenshot's timestamp. This handles edge cases where `endTime` is slightly before the screencast frame.

Specifically: if `best` is found but there's a screenshot within ~100ms *after* the playhead that's closer to the current action's `endTime`, prefer that one.

### Files to change
- `src/components/TraceStudio.jsx` — ~6 locations, all small edits

