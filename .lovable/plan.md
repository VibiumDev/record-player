

## Plan: Show progress bar on collapsed group headers

### Problem
When a group is collapsed in the Inspector, the active action's progress bar is hidden. The group header should show the progress bar instead.

### Changes (single file: `src/components/TraceStudio.jsx`)

**In the group-start rendering block (~lines 1553-1570):**

When `isCollapsed && isActive`, determine the current action within the group, compute its progress relative to playhead, and render the same 2px progress bar at the bottom of the group header div.

Specifically:
1. Find the current active action within the collapsed group: filter `filteredActions` for actions where `a.startTime >= g.startTime && a.endTime <= g.endTime && playhead >= a.startTime && playhead <= a.endTime + 200`
2. If found, compute progress: `duration > 0 ? clamp((playhead - a.startTime) / duration) : 1`
3. Add `position: "relative"` to the group header div's style
4. Append the same progress bar markup (absolute bottom, 2px height) inside the group header div, using the group's purple color instead of action color

This reuses the exact same visual pattern from the action items (lines 1608-1623), just rendered on the group header when collapsed.

