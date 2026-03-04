

## Plan: URL parameter trace loading + demo file

### Changes

1. **Copy demo file to public folder**
   - Copy `user-uploads://vibium-demo-trace.zip` → `public/vibium-demo-trace.zip`

2. **Add URL `?trace=` parameter support in `TraceStudio.jsx`**
   - Add a `useEffect` near the existing `loadTrace` callback (~line 1018) that:
     - Reads `window.location.search` for a `trace` param
     - If present, fetches the file via `fetch()`, converts response to a `Blob`, then calls `loadTrace(blob)`
     - Runs once on mount (empty deps + `loadTrace`)
   - The param value is treated as a relative or absolute URL, so `?trace=vibium-demo-trace.zip` fetches from `/vibium-demo-trace.zip` (public folder)

### Implementation detail

```javascript
// After loadTrace definition (~line 1018)
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const traceUrl = params.get("trace");
  if (traceUrl) {
    const url = traceUrl.startsWith("http") ? traceUrl : `/${traceUrl}`;
    fetch(url)
      .then(r => { if (!r.ok) throw new Error(`Failed to fetch ${traceUrl}`); return r.blob(); })
      .then(blob => loadTrace(blob))
      .catch(e => setError(e.message));
  }
}, []);
```

This keeps it simple — relative paths resolve from the public folder, and full URLs work for remote traces.

