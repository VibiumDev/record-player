

## Plan: Expand screenshot when inspector collapsed in stacked mode

### Problem
When inspector is collapsed in stacked mode, the screenshot area keeps its fixed height (`screenshotH || "50%"`), leaving empty space. It should expand to fill the available space.

### Change (single file: `src/components/TraceStudio.jsx`)

**Line 1472** — Change the screenshot container's `flex` and `height` in stacked mode to account for `showSide`:

- When `layoutMode === "stacked"` and `showSide` is true: keep current behavior (`flex: "none"`, `height: screenshotH || "50%"`)
- When `layoutMode === "stacked"` and `showSide` is false: use `flex: 1` and no fixed height, so it fills available space above the expand bar and timeline

```javascript
// Before:
flex: layoutMode === "stacked" ? "none" : 1,
height: layoutMode === "stacked" ? (screenshotH || "50%") : undefined,

// After:
flex: (layoutMode === "stacked" && showSide) ? "none" : 1,
height: (layoutMode === "stacked" && showSide) ? (screenshotH || "50%") : undefined,
```

This is a one-line change that makes the screenshot area expand to fill available space when the inspector is collapsed in stacked mode.

