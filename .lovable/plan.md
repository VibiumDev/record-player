

## Plan: Add stacked (single-column) layout mode

### Concept
Add a `layoutMode` state (`"main"` | `"stacked"`) toggled from the toolbar. In stacked mode, the screenshot and inspector render as vertically stacked rows instead of the default side-by-side layout.

### Changes (single file: `src/components/TraceStudio.jsx`)

**1. New state + persistence (~near other panel states)**
```javascript
const [layoutMode, setLayoutMode] = useState(getPanelDefault("layout", "main"));
```
```javascript
useEffect(() => { try { localStorage.setItem("trace-panel-layout", layoutMode); } catch {} }, [layoutMode]);
```

**2. Toolbar toggle button (after highlight toggle)**
```javascript
<button
  onClick={() => setLayoutMode(m => m === "main" ? "stacked" : "main")}
  title={layoutMode === "main" ? "Stacked layout" : "Default layout"}
  style={{ /* same style as loop/highlight toggles */ }}
>
  {layoutMode === "stacked" ? "▤" : "▥"}
</button>
```

**3. Main area layout change**

- **`"main"` (current behavior):** No changes — horizontal flex with screenshot + divider + inspector side panel.
- **`"stacked"`:** Single column flex:

```text
┌─────────────────────────────┐
│  Toolbar (controls)         │
├─────────────────────────────┤
│  Screenshot + overlays      │
│  (resizable height)         │
├── horizontal divider ───────┤
│  Inspector tabs (full width)│
├─────────────────────────────┤
│  Timeline                   │
└─────────────────────────────┘
```

- Main area uses `flexDirection: "column"` instead of `"row"`
- Screenshot gets a controlled height (`screenshotH` state, default ~50%) with horizontal resize divider
- Inspector fills remaining vertical space at full width
- Side panel divider/width not rendered
- `showSide` still controls inspector visibility

**4. Keyboard shortcut:** `V` key toggles layout mode.

**5. Mobile:** Hide toggle on mobile (already effectively stacked).

