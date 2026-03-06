

## Plan: Auto-switch to stacked layout on narrow/portrait screens

### What changes
In `src/components/TraceStudio.jsx`, add an effect that automatically switches `layoutMode` to `"stacked"` when the viewport is narrow (< 768px wide) or in portrait orientation, and back to `"main"` when it widens. This uses the existing `mobile` state plus a new portrait-orientation media query check.

### Implementation

**1. Add a `useEffect` that auto-sets layout based on screen size (~after the existing mobile/compact collapse effect, line ~857)**

When `mobile` becomes `true` OR when the viewport is in portrait and narrow (e.g. < 900px), set `layoutMode` to `"stacked"`. When `mobile` becomes `false` and orientation is landscape/wide, restore `"main"`.

```javascript
useEffect(() => {
  if (mobile) {
    setLayoutMode("stacked");
  }
}, [mobile]);
```

We also listen for orientation/resize changes for tablets in portrait:

```javascript
useEffect(() => {
  const check = () => {
    const portrait = window.innerHeight > window.innerWidth;
    const narrow = window.innerWidth < 900;
    if (portrait && narrow) setLayoutMode("stacked");
  };
  check();
  window.addEventListener("resize", check);
  return () => window.removeEventListener("resize", check);
}, []);
```

**2. Show the layout toggle on mobile too** — remove the `!mobile &&` guard on the toggle button (~line 1413) so users can manually switch back if desired.

This is a lightweight change: two small effects and removing one conditional wrapper.

