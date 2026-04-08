

# Restore Highlight Toggle in Compare Mode

## Problem
When `hideControls` is true (compare mode), the entire toolbar is hidden, which removes the highlight toggle button. The overlay rendering still works internally (gated by `overlayEnabled` state), but users have no way to toggle it.

## Solution

Add a highlight toggle button (🔦) to the **shared CompareStudio toolbar** that controls both players simultaneously.

### Changes

**`src/components/RecordStudio.jsx`**
- Expose `setOverlayEnabled` and `overlayEnabled` via the imperative handle:
  - `setHighlight(bool)` — sets `overlayEnabled`
  - Add `highlight` to `getState()` return

**`src/components/CompareStudio.jsx`**
- Add local `highlightOn` state (default `true`)
- Add a 🔦 toggle button in the shared toolbar (matching existing button style)
- On toggle, call `both(r => r?.setHighlight?.(next))` and update local state
- Place it near the loop button in the transport controls area

