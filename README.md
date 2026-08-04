# Vibium Record Player

**URL**: [player.vibium.dev](https://player.vibium.dev)

A web-based player for Vibium record ZIPs, Playwright `trace.zip` archives, and Twee recordings. Drop a recording onto the page and explore its timeline without installing anything.

## Features

- **Drag & Drop** — Open Vibium record ZIPs, Playwright `trace.zip` archives, or Twee recordings by dropping them onto the player
- **Action Timeline** — Step through recorded actions and Playwright test steps with timing info
- **Screenshot Filmstrip** — Scrub through screencast frames captured during the recording
- **Console Logs** — View browser console output tied to the recording timeline
- **Network Inspector** — Browse recorded network activity with method, status, URL, and size
- **Context Info** — See browser, viewport, and other recorded metadata
- **Multi-page playback** — Follow recordings that open or use more than one page
- **Fully Client-Side** — Recording processing runs in the browser; no data is uploaded by the hosted player

## Getting Started

### Use it online

Visit **[player.vibium.dev](https://player.vibium.dev)** and drop a Vibium `record.zip`, Playwright `trace.zip`, or Twee `.twee` recording onto the page.

## Recording support

The hosted player accepts Vibium record ZIPs, Playwright `trace.zip` archives, and Twee recordings. For Playwright traces, the MVP includes action and test-step timelines, screenshot playback, console output, network activity, recorded metadata, and multi-page playback.

Full DOM snapshot inspection, source browsing, attachment viewers, and request or response body viewers are intentionally deferred. They are not part of the initial Playwright trace experience.

Recording files can contain sensitive data, including URLs, headers, cookies, console output, source locations, and values entered during a test. Processing is client-side, but review files carefully before opening them on any device or sharing them with others.

### Run locally

```sh
git clone https://github.com/VibiumDev/record-player.git
cd record-player
npm i
npm run dev
```

Then open `http://localhost:5173` in your browser.

## Reusable package entry points

This repository now exposes a first reusable API slice under `src/packages` while preserving the hosted Vite app:

- `player-core` — ZIP loading and parsing (`parseRecording`, `loadRecording`) for Vibium, Playwright, and Twee recordings, plus the `LoadedRecording`, timeline, screenshot, and error contracts. URL loading uses `fetch` with browser `same-origin` credentials by default and supports an injected fetch implementation and abort signal.
  - `player-react` — `RecordPlayer` and `RecordPlayerLoader` React components for rendering or fetching any supported recording. `displayTitle` supplies host-owned title text without changing parsed recording data.
  - `player-element` — `defineVibiumRecordPlayerElement()` for registering the backward-compatible `<vibium-record-player src="/record.zip">` element. Despite its existing name, the element accepts Vibium, Playwright, and Twee recordings. Use the `recording-title` attribute/property for a host-owned display title; it updates presentation without fetching again. It dispatches `vibium-player-ready` with `{ recording }` and `vibium-player-error` with `{ error }`. Set its `credentials` attribute or property to `omit`, `same-origin`, or `include` to control recording fetch credentials. The default is `same-origin` for backward compatibility.

`RecordPlayer` includes a fullscreen control when the browser supports the Fullscreen API. When embedding it in an iframe, grant that iframe fullscreen permission (for example, with the `allowfullscreen` attribute).

## Tech Stack

- React + Vite + TypeScript
- Tailwind CSS
- JSZip
- shadcn/ui

## License

MIT
