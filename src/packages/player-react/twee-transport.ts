/** The maximum wall-clock time spent crossing an idle gap, matching `twee play`. */
export const TWEE_MAX_IDLE_MS = 2_000;

/**
 * Advance a Twee trace clock by one animation frame.
 *
 * Event timestamps deliberately remain on the recording's raw clock. Before
 * consuming the frame's wall time, a gap to the next undispatched event is
 * capped at `maxIdleMs`, just as native `twee play` does.
 */
export function advanceTweePlayhead(
  currentTime: number,
  elapsed: number,
  eventTimes: readonly number[],
  duration: number,
  maxIdleMs = TWEE_MAX_IDLE_MS,
): number {
  const end = Math.max(0, Number.isFinite(duration) ? duration : 0);
  let playhead = Math.min(end, Math.max(0, Number.isFinite(currentTime) ? currentTime : 0));
  const frameElapsed = Math.max(0, Number.isFinite(elapsed) ? elapsed : 0);
  const idleCap = Math.max(0, Number.isFinite(maxIdleMs) ? maxIdleMs : 0);
  const nextEventTime = eventTimes.find((time) => Number.isFinite(time) && time > playhead);

  if (nextEventTime != null && idleCap > 0 && nextEventTime - playhead > idleCap) {
    playhead = Math.max(playhead, nextEventTime - idleCap);
  }

  return Math.min(end, playhead + frameElapsed);
}
