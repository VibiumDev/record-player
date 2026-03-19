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

## Tech Stack

- React + Vite + TypeScript
- Tailwind CSS
- JSZip (loaded from CDN at runtime)
- shadcn/ui

## License

MIT
