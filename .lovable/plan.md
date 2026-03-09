
Root cause I found: the landing-page logo references `animation: "spin-record 3s linear infinite"`, but the `@keyframes spin-record` CSS is only injected inside the **loaded-record UI branch** (`traceData` path).  
So when you’re on true landing (`!traceData`), the animation name exists but keyframes do not, so hover/tap does nothing.

Implementation plan:
1. Make `spin-record` keyframes globally available
   - Move the keyframes to a shared/global place (best: `src/index.css`, or a top-level style block rendered regardless of `traceData`).
   - Keep the same animation name (`spin-record`) so existing inline styles continue to work.

2. Keep one consistent interaction model for both logos
   - Ensure both landing logo (`VIBIUM_LOGO_HI`) and toolbar logo (`VIBIUM_LOGO`) use identical handlers:
     - Desktop: start on `onMouseEnter`, stop on `onMouseLeave`
     - Mobile: toggle on `onClick`
   - Reuse the same `logoSpinning` state (already present).

3. Improve visual reliability
   - Add `transformOrigin: "50% 50%"` and optionally `willChange: "transform"` to both logo styles for smoother, obvious spin.
   - Keep rotation speed at `3s linear infinite` unless you want slower/faster.

4. Verify true landing route behavior
   - Confirm landing route has no `record` query param (because `?record=...` bypasses landing entirely).
   - Validate that animation now works on:
     - landing logo (no trace loaded)
     - toolbar logo (trace loaded)

Technical details to apply:
- Current affected file: `src/components/RecordStudio.jsx`
- Recommended global style target: `src/index.css`
- Key snippet to centralize:
```css
@keyframes spin-record {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

Validation checklist:
- Desktop landing: hover logo starts spin, leaving logo stops spin.
- Mobile landing: first tap starts spin, second tap stops spin.
- Loaded-record UI still behaves the same.
- No console CSS errors and no regressions in other animations.
