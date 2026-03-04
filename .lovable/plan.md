

## Plan: Persist panel states with localStorage, default open on first trace load

### Problem
Panels default to closed. New users don't see panels until they click play. Panel state doesn't survive page reload.

### Approach
Use `localStorage` to persist each panel's open/closed state. On first visit (no stored preference), panels open when a trace is loaded. URL params still override everything.

### Changes (single file: `src/components/TraceStudio.jsx`)

**1. Helper to read stored panel state (~before component, near `parseUrlParams`)**

```javascript
function getPanelDefault(key, fallback) {
  try {
    const v = localStorage.getItem(`trace-panel-${key}`);
    if (v === "true") return true;
    if (v === "false") return false;
    return fallback;
  } catch { return fallback; }
}
```

**2. Update initial state (lines 799-802)**

Change defaults from `false`/`true` to use stored values, with `false` as the fallback (before a trace is loaded, panels stay closed):

```javascript
const [showSide, setShowSide] = useState(urlParams.inspector ?? getPanelDefault("inspector", false));
const [showTimeline, setShowTimeline] = useState(urlParams.timeline ?? getPanelDefault("timeline", false));
const [showToolbar, setShowToolbar] = useState(urlParams.controls ?? getPanelDefault("controls", true));
```

**3. Persist on toggle — add a `useEffect` for each panel**

```javascript
useEffect(() => { try { localStorage.setItem("trace-panel-inspector", showSide); } catch {} }, [showSide]);
useEffect(() => { try { localStorage.setItem("trace-panel-timeline", showTimeline); } catch {} }, [showTimeline]);
useEffect(() => { try { localStorage.setItem("trace-panel-controls", showToolbar); } catch {} }, [showToolbar]);
```

**4. Open all panels on first trace load**

After `loadTrace` completes successfully (~end of the try block around line 995), check if user has any stored preference. If not (first visit), open all panels:

```javascript
const hasStoredPrefs = ["inspector","timeline","controls"].some(k => localStorage.getItem(`trace-panel-${k}`) !== null);
if (!hasStoredPrefs && !mobile && !compact) {
  setShowSide(true);
  setShowTimeline(true);
  setShowToolbar(true);
}
```

This also replaces the play-button logic at line 1446 — panels will already be open after loading, so the play button just starts playback.

