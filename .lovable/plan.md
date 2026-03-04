

## Plan: Only auto-open panels on first trace load if there's room

### Change (single file: `src/components/TraceStudio.jsx`)

In the first-time-visitor auto-open block (~line 1008), add the `mobile`/`compact` guard:

```javascript
// Current:
const hasStoredPrefs = ["inspector","timeline","controls"].some(k => localStorage.getItem(`trace-panel-${k}`) !== null);
if (!hasStoredPrefs) {
  setShowSide(true);
  setShowTimeline(true);
  setShowToolbar(true);
}

// Change to:
const hasStoredPrefs = ["inspector","timeline","controls"].some(k => localStorage.getItem(`trace-panel-${k}`) !== null);
if (!hasStoredPrefs) {
  const isMobile = window.innerWidth < 768;
  const isCompact = window.innerHeight < 500;
  if (!isMobile && !isCompact) {
    setShowSide(true);
    setShowTimeline(true);
  }
  setShowToolbar(true); // controls bar always opens
}
```

Uses the same 768px/500px thresholds as the existing `mobile`/`compact` detection. Controls toolbar still opens (it's minimal), but inspector and timeline only open when there's room.

