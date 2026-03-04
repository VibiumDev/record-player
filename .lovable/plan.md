

## Add horizontal scrubber indicator to side panel actions

When viewing actions in the bottom timeline, the scrubber's position within an action bar visually communicates whether you're looking at the "before" (left edge) or "after" (right edge) state. The right/side panel has no equivalent — you just see a highlighted row with no sense of *where* within the action's duration the playhead sits.

### Design

Add a thin horizontal progress bar at the bottom of each **active or selected** action row in the side panel. The bar fills from left to right proportionally based on where the playhead falls within `[startTime, endTime]`:

- Playhead at `startTime` → bar at 0% (left edge)
- Playhead at `endTime` → bar at 100% (right edge)
- Playhead between → proportional fill

The bar will be a 2px-tall strip using the action's color, placed at the bottom of the action row. It only renders when the action is active or selected and the playhead is within its time range.

### Implementation

**File: `src/components/TraceStudio.jsx`** (side panel action rendering, ~line 1538-1561)

Inside the action row `<div>`, after the existing children, add a conditional scrubber element:

```jsx
{/* Playhead position indicator */}
{(isActive || selectedAction === a) && playhead >= a.startTime && playhead <= (a.endTime || a.startTime) && (() => {
  const duration = (a.endTime || a.startTime) - a.startTime;
  const progress = duration > 0 ? Math.min(1, Math.max(0, (playhead - a.startTime) / duration)) : 0;
  return (
    <div style={{
      position: "absolute", bottom: 0, left: 0, right: 0, height: 2,
      background: V.border, borderRadius: 1, overflow: "hidden",
    }}>
      <div style={{
        width: `${progress * 100}%`, height: "100%",
        background: c, borderRadius: 1, transition: "width 0.1s linear",
      }} />
    </div>
  );
})()}
```

The parent action row div needs `position: "relative"` added to its style (currently not set).

This is a small, self-contained change — one style property addition and one new child element in the action row template.

