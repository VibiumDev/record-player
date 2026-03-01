# Vibium Trace Viewer

**URL**: [trace.vibium.dev](https://trace.vibium.dev)

A web-based viewer for Vibium trace files (`.zip`). Drop a `trace.zip` onto the page and instantly explore actions, screenshots, console logs, and network requests — no install required.

## Features

- **Drag & Drop** — Open any Vibium `trace.zip` by dropping it onto the viewer
- **Action Timeline** — Step through every recorded action (clicks, fills, navigations, assertions) with timing info
- **Screenshot Filmstrip** — Scrub through screencast frames captured during the trace
- **Console Logs** — View all browser console output (log, warn, error) tied to the trace timeline
- **Network Inspector** — Browse every network request with method, status, URL, and size
- **Context Info** — See browser, viewport, and other context options used during the run
- **Fully Client-Side** — Everything runs in the browser; no data is uploaded anywhere

## Getting Started

### Use it online

Visit **[trace.vibium.dev](https://trace.vibium.dev)** and drop a Vibium `trace.zip` file onto the page.

### Run locally

```sh
git clone <YOUR_GIT_URL>
cd <YOUR_PROJECT_NAME>
npm i
npm run dev
```

Then open `http://localhost:5173` in your browser.

## Tech Stack

- React + Vite + TypeScript
- Tailwind CSS
- JSZip (loaded from CDN at runtime)
- shadcn/ui

## License

MIT
