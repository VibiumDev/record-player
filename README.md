# Vibium Record Player

**URL**: [player.vibium.dev](https://player.vibium.dev)

A web-based player for Vibium recording files (`.zip`). Drop a `record.zip` onto the page and instantly explore actions, screenshots, console logs, and network requests — no install required.

## Features

- **Drag & Drop** — Open any Vibium `record.zip` by dropping it onto the player
- **Action Timeline** — Step through every recorded action (clicks, fills, navigations, assertions) with timing info
- **Screenshot Filmstrip** — Scrub through screencast frames captured during the recording
- **Console Logs** — View all browser console output (log, warn, error) tied to the recording timeline
- **Network Inspector** — Browse every network request with method, status, URL, and size
- **Context Info** — See browser, viewport, and other context options used during the run
- **Fully Client-Side** — Everything runs in the browser; no data is uploaded anywhere

## Getting Started

### Use it online

Visit **[player.vibium.dev](https://player.vibium.dev)** and drop a Vibium `record.zip` file onto the page.

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

- `player-core` — pure ZIP loading/parsing (`parseRecording`, `loadRecording`) plus `LoadedRecording`, `TimelineModel`, `RecordingEvent`, `ScreenshotIndex`, and `PlayerError` contracts. URL string loading uses `fetch` with browser `same-origin` credentials by default and supports injected fetch/signal.
- `player-react` — `RecordPlayer` and `RecordPlayerLoader` React components for rendering a loaded recording or fetching one from `src`.
- `player-element` — `defineVibiumRecordPlayerElement()` for registering `<vibium-record-player src="/record.zip">`; it dispatches `vibium-player-ready` with `{ recording }` and `vibium-player-error` with `{ error }`. Set its `credentials` attribute or property to `omit`, `same-origin`, or `include` to control recording fetch credentials. The default is `same-origin` for backward compatibility.

Remaining migration work is intentionally staged: the hosted app still uses the existing full-featured studio UI, while future PRs can replace its embedded parser with `player-core`, add formal library build outputs, and migrate the full timeline/compare experience onto these public contracts.

## Tech Stack

- React + Vite + TypeScript
- Tailwind CSS
- JSZip
- shadcn/ui

## License

MIT
