

## Plan: Show total group progress on collapsed headers

### Problem
Currently the collapsed group header progress bar tracks individual action progress within the group, causing repeating animation. It should instead show a single continuous progress bar for the entire group duration.

### Change (single file: `src/components/TraceStudio.jsx`)

In the collapsed group progress bar block (lines ~1570-1584), replace the per-action progress calculation with group-level progress:

- Remove the `activeAction` lookup
- Use `g.startTime` and `g.endTime` (the group's total span) to compute progress: `(playhead - g.startTime) / (g.endTime - g.startTime)`
- Clamp to 0–1
- Remove the `isActive` guard since we can just check `playhead >= g.startTime && playhead <= g.endTime`

This gives one smooth left-to-right fill across the entire group duration.

