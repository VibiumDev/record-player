
1) What I found in the current implementation
- The overlay already reads the rendered image size via `getBoundingClientRect()` (`iRect.width/height`) and computes image offset relative to the preview container (`imgLeft/imgTop`), so yes, it is using the currently rendered image size.
- The persistent “wildly misplaced” result is most likely not from missing rendered-size reads anymore; it is from using the wrong coordinate space for `action.point` / `action.box`.
- Right now the code assumes:
  - points/boxes are viewport coordinates, and
  - `contextOptions.options.viewport` is always the correct basis.
- The trace parser currently skips `frame-snapshot` events entirely. That means no scroll/frame offset context is available when mapping points/boxes.
- If points/boxes are in page-space for some actions (or affected by frame/scroll context), highlights will be consistently offset even with correct image scaling math.

2) Proposed fix approach
- Keep the current “measure real rendered image rect first” approach (it’s needed and correct).
- Fix mapping by introducing an explicit coordinate normalization pipeline before rendering:
  1. Parse and store minimal frame snapshot metadata (viewport + scroll offsets) keyed by snapshot id/name.
  2. Link each action to the best available snapshot context (`beforeSnapshot`, `afterSnapshot`, or input-linked snapshot metadata if present).
  3. Normalize raw `point`/`box` into viewport-space coordinates by subtracting scroll offsets when appropriate.
  4. Map normalized viewport coordinates to rendered image coordinates.
- Add candidate-based fallback if metadata is incomplete:
  - Try coordinate bases in this order and pick the first that keeps point/box in-bounds (with tolerance):
    - normalized viewport from snapshot context,
    - context viewport,
    - screenshot dimensions (raw),
    - screenshot dimensions / DPR,
    - natural image dimensions / DPR.
- Add strict guardrails:
  - If mapped point/box lands far outside image bounds after all attempts, do not render overlay for that action (better than rendering nonsense).

3) Concrete implementation plan (file: `src/components/TraceStudio.jsx`)
- Update `processTraceEvents`:
  - Stop discarding `frame-snapshot` blindly.
  - Build a `snapshotMetaMap` with whatever fields are present (defensive parsing):
    - snapshot identifier
    - viewport width/height
    - scrollX/scrollY
    - page/frame id when available
  - Attach snapshot-derived mapping context to actions.
- Add a normalization helper:
  - Input: action raw point/box + action snapshot meta + context viewport + screenshot meta + DPR.
  - Output: `{ coordW, coordH, normalizedPoint, normalizedBox, mappingSource }`.
  - If action coords look page-based and scroll metadata exists, convert to viewport-based first.
- Refactor `ActionOverlay`:
  - Use only normalized coordinates from helper.
  - Continue using actual measured image rect for final scaling.
  - Keep overlay anchored to the same container with `pointerEvents: none`.
  - Add out-of-bounds protection to suppress invalid overlays.
- Add lightweight debug mode (temporary, toggleable):
  - Show mapping source and computed scales (`coordW/H`, `imgW/H`, scrollX/Y).
  - This makes it easy to verify against your trace and remove ambiguity quickly.

4) Validation steps
- Reproduce with the same uploaded trace/screenshot scenario.
- Step through multiple action types:
  - click, fill/type, hover, check/select.
- Verify at least:
  - center-screen elements,
  - elements after page scroll,
  - early and late timeline positions.
- Confirm highlight box and cursor both align with targets at different image scales (zoomed in/out preview area).

5) Risks and mitigations
- Risk: Trace schema variations across versions (field names differ).
  - Mitigation: defensive parser with multiple field fallbacks and graceful degradation.
- Risk: Some actions may have incomplete metadata.
  - Mitigation: candidate fallback mapping + safe hide if invalid.
- Risk: iframe-related offsets.
  - Mitigation: preserve frame/page identifiers in snapshot metadata and prefer matching context when available.

6) Expected outcome
- Overlay positioning will be based on:
  - real rendered image dimensions,
  - corrected action coordinates (including scroll/frame context),
  - robust fallback logic when metadata is partial.
- This should eliminate the large offset/scaling failures you’re currently seeing instead of just shifting the error between viewport/DPR assumptions.
