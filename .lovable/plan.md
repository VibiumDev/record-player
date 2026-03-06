

## Plan: Fix inspector chevron direction in stacked mode

### Problem
In stacked mode, both the collapse and expand chevrons for the inspector panel show `▾` (down arrow). The collapse chevron on the divider (when inspector is visible) should point up (`▴`) since collapsing hides the panel below, and the expand chevron (when collapsed) should point down (`▾`) to indicate expanding downward.

### Change (single file: `src/components/TraceStudio.jsx`)

**Line 1576** — Change the stacked divider's collapse chevron from `▾` to `▴`:
```
// Before:  >▾</div>
// After:   >▴</div>
```

This makes it consistent: `▴` means "collapse inspector upward" and `▾` means "expand inspector downward."

