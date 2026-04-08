
# Side-by-Side Comparison Mode

## Overview

Add a "Compare" mode to Vibium Player where two zip files are loaded side-by-side: a **golden image** (expected) and a **test recording** (actual). Each side renders as an independent stacked-layout player, enabling quick visual comparison of where things diverged.

## Architecture

```text
┌─────────────────────────────────────────────────┐
│  CompareStudio (new wrapper)                    │
│ ┌──────────────────┐  ┌──────────────────┐      │
│ │  RecordStudio     │  │  RecordStudio     │     │
│ │  (golden/left)    │  │  (actual/right)   │     │
│ │  stacked layout   │  │  stacked layout   │     │
│ │  forced           │  │  forced           │     │
│ └──────────────────┘  └──────────────────┘      │
│  ── shared toolbar: sync playback, labels ──    │
└─────────────────────────────────────────────────┘
```

## Key Changes

### 1. Make RecordStudio accept props (refactor)

Currently `RecordStudio` is self-contained — it manages its own file loading, landing page, and layout. To reuse it in compare mode, add optional props:

- `initialFile` — a `Blob`/`File` to auto-load (skip landing page)
- `forceLayout` — lock to `"stacked"` layout
- `label` — display a label like "Expected" or "Actual" in the toolbar
- `hideGlobalChrome` — suppress the landing page, help overlay, and footer when embedded
- `compact` — hint to reduce padding/chrome

This is a props-passthrough approach — minimal changes to the existing component.

### 2. New `CompareStudio` component

A new top-level component that:

- Shows a **compare landing page** with two drop zones (left: "Golden / Expected", right: "Actual / Test")
- Once both files are loaded, renders two `RecordStudio` instances side-by-side, each forced into stacked layout
- Provides a shared header bar with labels ("Expected" | "Actual") and a button to reset/reload files
- Optional: a "sync playback" toggle that links the two players' playheads

### 3. Routing / Entry point

- Add a `/compare` route in `App.tsx` that renders `CompareStudio`
- Add a "Compare" link on the main landing page
- Support URL params: `?left=url1&right=url2` for direct-link comparison

### 4. Landing page update

Add a small "Compare two recordings" link/button on the existing landing page, linking to `/compare`.

## Technical Notes

- RecordStudio is ~4000 lines. The refactor keeps changes minimal — just threading a few optional props through, not a major restructure.
- Each player instance maintains independent state (playhead, zoom, panels). Sync is opt-in.
- The stacked layout is already implemented; forcing it just means setting `layoutMode="stacked"` and hiding the toggle.
- Each side gets roughly 50% viewport width; the stacked layout works well in narrow containers.

## Files to Create/Modify

| File | Change |
|------|--------|
| `src/components/RecordStudio.jsx` | Add optional props: `initialFile`, `forceLayout`, `label`, `hideGlobalChrome`. Wire them into existing logic. |
| `src/components/CompareStudio.jsx` | New component: dual drop zones, side-by-side RecordStudio rendering |
| `src/pages/Compare.tsx` | New page wrapper |
| `src/App.tsx` | Add `/compare` route |

## Scope

This plan focuses on the core side-by-side viewer. Synced playback (linking both timelines) can be added as a follow-up.
