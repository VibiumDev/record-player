

# Element Highlight and Cursor Animation

## Overview
Add visual overlays on the screenshot preview area that show cursor movement, element highlighting, and click/type effects for actions that have `input` events (containing `point` and `box` data).

## Changes

### 1. Parse `input` events in `processTraceEvents`
Currently, `input` events are silently ignored. Add handling in the event loop to attach `point` and `box` data to the matching action via `callId`.

- When `type === "input"`, look up the action in `actionMap` by `callId`
- Store `evt.point` and `evt.box` on the action object

### 2. Add overlay layer on the screenshot preview
The screenshot area (around line 871) currently renders a plain `<img>`. Wrap it in a container with `position: relative` and add an SVG/div overlay on top that draws:

- **Highlight rectangle**: Semi-transparent colored box at the `box` coordinates of the current action, with a subtle border matching the action color
- **Cursor indicator**: A small cursor icon positioned at `point`, animated to move from the previous action's point to the current one
- **Click ripple**: For click/tap/dblclick actions, an expanding ring animation at `point`
- **Type indicator**: For fill/type actions, a blinking text cursor at `point`

### 3. Coordinate mapping
The overlay must scale coordinates to match the displayed screenshot size. Use the screenshot's natural dimensions (`currentScreenshot.width`, `currentScreenshot.height`) and the rendered `<img>` element's actual size to compute scale factors. A `ref` on the image element and a `ResizeObserver` (or `onLoad` handler) will track the rendered dimensions.

### 4. Cursor animation
Track the previous action's `point` to animate cursor movement using CSS transitions (or a brief `requestAnimationFrame` tween). When the playhead moves to a new action:
- Animate cursor from `prevPoint` to `currentPoint` over ~200ms
- Then trigger the action-specific effect (ripple or type cursor)

### 5. Implementation details

**State additions:**
- `prevPoint` — ref tracking the last cursor position for animation

**New sub-component (inline):**
- `ActionOverlay` — renders inside the screenshot container, receives `currentAction`, `currentScreenshot`, image dimensions, and previous point
- Uses CSS `transition` on `left`/`top` for smooth cursor movement
- Uses CSS `@keyframes` (injected via `<style>`) for ripple and blink effects

**Event types to handle:**
- Click/tap/dblclick: highlight box + cursor move + ripple
- Fill/type/press: highlight box + cursor move + blinking caret
- Hover/check/uncheck/select: highlight box + cursor move (no extra effect)
- No `input` event: no overlay shown

## Technical Notes

- All rendering is done with absolutely-positioned divs over the screenshot image — no canvas needed
- The highlight box uses the action's color at ~20% opacity with a 2px solid border
- The cursor is a small SVG pointer icon (standard arrow cursor shape, ~20px)
- Ripple effect: a circle expanding from 0 to ~40px radius, fading from 60% to 0% opacity over 400ms
- Coordinate scaling: `displayX = point.x * (imgRenderedWidth / screenshotNaturalWidth)`, same for Y
- The overlay is pointer-events: none so it doesn't interfere with swipe/click interactions
- Only shown when `currentAction` has a `point` property (i.e., had an `input` event)
