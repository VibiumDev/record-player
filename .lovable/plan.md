

## Plan: Widen divider touch targets on mobile

### Problem
All dividers (stacked horizontal, side vertical, detail, timeline) have a fixed 9px hit area, which is too narrow for touch interaction on mobile devices.

### Approach
Add a wider invisible touch area on mobile by using `::after` pseudo-element-style padding. Since this is inline-styled JSX, the simplest approach is to increase the divider element's size on touch devices using the existing `mobile` / `compact` state variables already available in the component.

### Changes (single file: `src/components/TraceStudio.jsx`)

There are 4 dividers that all use `height: 9` or `width: 9`. For each, change the size to be larger on mobile:

1. **Stacked divider** (~line 1562): `height: 9` → `height: mobile ? 24 : 9`
2. **Side (col-resize) divider** (~line 1587): `width: 9` → `width: mobile ? 24 : 9`
3. **Detail divider** (~line 1877): `height: 9` → `height: mobile ? 24 : 9`
4. **Timeline divider** (~line 1953): `height: 9` → `height: mobile ? 24 : 9`

The visual line inside each divider (the 1px colored border) remains centered, but the grabbable area expands to 24px on mobile, providing a much larger touch target while keeping the visual appearance minimal.

