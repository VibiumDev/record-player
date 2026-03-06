

## Plan: Rename localStorage keys and DOM references

### Changes (single file: `src/components/TraceStudio.jsx`)

**1. localStorage keys** — Replace all `trace-panel-` prefixes with `record-panel-`:
- Line 443: `trace-panel-${key}` → `record-panel-${key}`
- Line 1052: `trace-panel-${k}` → `record-panel-${k}`
- Line 1069: `trace-panel-inspector` → `record-panel-inspector`
- Line 1070: `trace-panel-timeline` → `record-panel-timeline`
- Line 1071: `trace-panel-controls` → `record-panel-controls`
- Line 1072: `trace-panel-layout` → `record-panel-layout`

**2. Component/function name** — `TraceStudio` → `RecordStudio`:
- Line 789: `forwardRef(function TraceStudio` → `forwardRef(function RecordStudio`
- The `export default` at the bottom

**3. UI text** (from the previously approved but not yet implemented branding plan):
- Line 1330: sample link text and URL — `/?trace=vibium-demo-trace.zip` → `/?record=vibium-demo-record.zip`, `"view a sample trace"` → `"play a sample recording"`

Note: Internal variable names like `traceData`, `processTraceEvents` stay unchanged since they relate to the `.trace` file format.

This will be combined with the full rename refactor (file rename to `RecordStudio.jsx`, `index.html` meta updates, `README.md`, etc.) from the previously approved plan.

