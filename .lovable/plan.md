

# Vibium Trace

A trace viewer app that lets you drop a Vibium trace.zip file to visualize and inspect browser automation traces.

## Plan

### 1. Set up the app shell
- Copy the uploaded `trace-studio.jsx` file into the project as-is with no modifications
- Update the Index page to render the `TraceStudio` component as the full-page app
- Update the page title to "Vibium Trace"

### 2. What it does (already built into your JSX)
- **Drag & drop** a Vibium trace.zip file onto the viewer
- **Unzip and parse** NDJSON event files and extract screenshots
- **Timeline playback** with play/pause, speed control, and scrubbing
- **Action list** showing clicks, navigations, typing, and other browser actions
- **Screenshot viewer** with zoom controls
- **Console & network panels** for debugging trace data
- **Dark/light mode** toggle
- **Keyboard shortcuts** for efficient navigation
- **URL parameters** for controlling initial view state

