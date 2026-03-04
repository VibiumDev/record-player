

## Fix: Remove highlight when playhead is exactly at action end

The issue is on line 1316 where the condition uses `playhead <= end + 50`, which keeps the highlight visible even when the scrubber lands exactly on the end of a click action. The `+50` buffer was added in the last edit to help keyboard navigation, but it's too generous.

**Change**: Revert the end condition from `playhead <= end + 50` back to `playhead < end` (strict less-than, no buffer). The start buffer (`playhead >= start - 50`) can remain since it helps show the highlight just before the action begins.

This is a single inline change on line 1316 in `src/components/TraceStudio.jsx`:
- `playhead >= start - 50 && playhead <= end + 50` → `playhead >= start - 50 && playhead < end`

