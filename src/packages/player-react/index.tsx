import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import {
  loadRecording,
  type LoadedRecording,
  type LoadRecordingOptions,
  PlayerError,
  type TweeEvent,
  type TweeRecording,
  type VibiumRecording,
  type PlaywrightRecording,
  type RecordingEvent,
} from "../player-core";
import {
  TerminalPresentation,
  type GhosttyTerminalFactory,
} from "./terminal";
import { advanceTweePlayhead } from "./twee-transport";

export {
  sanitizeGhosttyHTML,
  TerminalPresentation,
  type GhosttyTerminalFactory,
  type TerminalPresentationProps,
} from "./terminal";
export { advanceTweePlayhead, TWEE_MAX_IDLE_MS } from "./twee-transport";

export interface RecordPlayerProps {
  recording: LoadedRecording;
  /** Host-owned label displayed over the recording. */
  displayTitle?: React.ReactNode;
  inspector?: boolean | "visible" | "hidden";
  timeline?: boolean | "visible" | "hidden";
  className?: string;
  style?: React.CSSProperties;
  storageKey?: string | false;
  /** Primarily useful for deterministic tests and custom WASM hosting. */
  terminalFactory?: GhosttyTerminalFactory;
}

export interface RecordPlayerLoaderProps extends Omit<RecordPlayerProps, "recording"> {
  src: URL | string;
  fetch?: LoadRecordingOptions["fetch"];
  credentials?: RequestCredentials;
  onReady?: (recording: LoadedRecording) => void;
  onError?: (error: PlayerError | Error) => void;
  loadingFallback?: React.ReactNode;
  errorFallback?: (error: PlayerError | Error) => React.ReactNode;
}

function formatMs(value: number): string {
  if (!Number.isFinite(value)) return "0ms";
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(2)}s`;
  return `${Math.round(value)}ms`;
}

function formatClock(value: number): string {
  const seconds = Math.max(0, Math.floor(value / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function recordingTitle(recording: LoadedRecording): string {
  const source = recording.source?.split(/[\\/]/).filter(Boolean).pop();
  return source || "Recording";
}

function optionVisible(
  value: boolean | "visible" | "hidden" | undefined,
  defaultValue = true,
): boolean {
  if (value === "hidden") return false;
  if (value === "visible") return true;
  return value ?? defaultValue;
}

function eventKind(recording: LoadedRecording, event: LoadedRecording["timeline"]["events"][number]): string {
  return recording.format === "twee"
    ? (event as TweeEvent).type
    : (event as RecordingEvent).kind;
}

function eventLabel(event: TweeEvent): string {
  if (event.type === "input") {
    if (event.key) return `Input key: ${event.key}`;
    if (event.mouse) return `Mouse input: ${event.mouse.gesture}`;
    const text = new TextDecoder().decode(event.bytes);
    return `Input${event.inputKind ? ` (${event.inputKind})` : ""}: ${text || `${event.bytes.byteLength} bytes`}`;
  }
  if (event.type === "resize") return `Resize to ${event.cols} × ${event.rows}`;
  if (event.type === "exit") return `Exit code ${event.code}`;
  return `Output: ${event.bytes.byteLength} bytes`;
}

function timelineMarkers(recording: LoadedRecording): LoadedRecording["timeline"]["events"] {
  const events = recording.timeline.events;
  if (recording.format !== "twee") return events.slice(0, 250);

  // Terminal output streams are dense. Keep the long-standing 250-marker
  // rendering budget for output, but never hide the input, resize, or exit
  // events users need to understand a Twee recording.
  const semantic = recording.terminalEvents.filter((event) => event.type !== "output");
  const outputBudget = Math.max(0, 250 - semantic.length);
  const outputEvents = recording.terminalEvents.filter((event) => event.type === "output");
  const sampledOutput = outputEvents.length <= outputBudget
    ? outputEvents
    : Array.from({ length: outputBudget }, (_, index) =>
      outputEvents[Math.floor((index * outputEvents.length) / outputBudget)]);

  return [...sampledOutput, ...semantic].sort((left, right) => left.time - right.time);
}

type BrowserRecording = VibiumRecording | PlaywrightRecording;

function browserPageId(event: RecordingEvent | undefined): string | undefined {
  return event?.browser?.pageId;
}

function BrowserPresentation({
  recording,
  currentTime,
  selectedPageId,
  onSelectPage,
  isFullscreen = false,
}: {
  recording: BrowserRecording;
  currentTime: number;
  selectedPageId?: string;
  onSelectPage: (pageId: string) => void;
  isFullscreen?: boolean;
}) {
  const currentAction = useMemo(() => recording.timeline.events
    .filter((event): event is RecordingEvent => event.kind === "action" && event.time <= currentTime && currentTime <= (event.endTime ?? event.time))
    .reduce<RecordingEvent | undefined>((latest, event) =>
      !latest || event.time >= latest.time ? event : latest, undefined), [currentTime, recording.timeline.events]);
  const pageIds = useMemo(() => {
    const ids = new Set<string>();
    recording.timeline.screenshots.forEach((screenshot) => {
      if (screenshot.pageId) ids.add(screenshot.pageId);
    });
    recording.timeline.events.forEach((event) => {
      const pageId = browserPageId(event as RecordingEvent);
      if (pageId) ids.add(pageId);
    });
    return [...ids];
  }, [recording.timeline.events, recording.timeline.screenshots]);
  const latestPageId = useMemo(() => {
    const candidates = [
      ...recording.timeline.screenshots.map((screenshot) => ({ pageId: screenshot.pageId, time: screenshot.time })),
      ...recording.timeline.events.map((event) => ({ pageId: browserPageId(event as RecordingEvent), time: event.time })),
    ].filter((candidate): candidate is { pageId: string; time: number } => Boolean(candidate.pageId) && candidate.time <= currentTime);
    return candidates.reduce<{ pageId: string; time: number } | undefined>((latest, candidate) =>
      !latest || candidate.time >= latest.time ? candidate : latest, undefined)?.pageId ?? pageIds[0];
  }, [currentTime, pageIds, recording.timeline.events, recording.timeline.screenshots]);
  // An action owns the display while it is current; an explicit page choice is
  // otherwise stable, and the latest observed page is the final fallback.
  const activePageId = browserPageId(currentAction) ?? selectedPageId ?? latestPageId;
  const screenshots = useMemo(
    () => recording.timeline.screenshots.filter((screenshot) =>
      screenshot.dataUrl && (!activePageId || screenshot.pageId === activePageId)),
    [activePageId, recording.timeline.screenshots],
  );
  const currentScreenshot = useMemo(() => {
    return screenshots.filter((screenshot) => screenshot.time <= currentTime)
      .reduce<typeof screenshots[number] | undefined>((current, screenshot) =>
        !current || screenshot.time >= current.time ? screenshot : current, undefined);
  }, [currentTime, screenshots]);

  if (!currentScreenshot?.dataUrl) return <div role="status">No screenshot for the selected page.</div>;
  return (
    <figure
      data-testid="screenshot-presentation"
      className="vrp-presentation"
    >
      <img
        src={currentScreenshot.dataUrl}
        alt="Current recording screenshot"
        className="vrp-screenshot"
      />
      {pageIds.length > 1 ? (
        <label className="vrp-page-selector">
          Page
          <select aria-label="Recording page" value={activePageId ?? ""} onChange={(event) => onSelectPage(event.currentTarget.value)} style={{ marginLeft: 6 }}>
            {pageIds.map((pageId) => <option key={pageId} value={pageId}>{pageId}</option>)}
          </select>
        </label>
      ) : null}
    </figure>
  );
}

function TweeDetails({ recording, isFullscreen = false }: { recording: TweeRecording; isFullscreen?: boolean }) {
  const detailEvents = recording.terminalEvents.filter((event) => event.type !== "output");
  const resizeCount = recording.terminalEvents.filter((event) => event.type === "resize").length;
  const inputCount = recording.terminalEvents.filter((event) => event.type === "input").length;
  const exit = [...recording.terminalEvents].reverse().find((event) => event.type === "exit");

  return (
    <div className="vrp-advanced">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 8,
          padding: 12,
          background: "#f8fafc",
          fontSize: 13,
        }}
      >
        <span><strong>Command:</strong> {recording.manifest.command.join(" ") || "—"}</span>
        <span><strong>Terminal:</strong> {recording.manifest.cols} × {recording.manifest.rows}</span>
        <span><strong>Duration:</strong> {formatMs(recording.timeline.duration)}</span>
        <span><strong>Input:</strong> {inputCount}</span>
        <span><strong>Resizes:</strong> {resizeCount}</span>
        <span><strong>Exit:</strong> {exit?.type === "exit" ? exit.code : "not recorded"}</span>
      </div>
      {detailEvents.length ? (
        <ol aria-label="Terminal event details" style={{ margin: 0, padding: 0, listStyle: "none", maxHeight: 240, overflow: "auto" }}>
          {detailEvents.map((event) => (
            <li
              key={event.id}
              style={{
                display: "grid",
                gridTemplateColumns: "80px minmax(0, 1fr)",
                gap: 8,
                padding: "7px 12px",
                borderTop: "1px solid #edf1f7",
                fontSize: 13,
              }}
            >
              <time>{formatMs(event.time)}</time>
              <span style={{ overflowWrap: "anywhere" }}>{eventLabel(event)}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

export function RecordPlayer({
  recording,
  displayTitle,
  inspector = true,
  timeline = true,
  className,
  style,
  terminalFactory,
}: RecordPlayerProps) {
  const showInspector = optionVisible(inspector);
  const showTimeline = optionVisible(timeline);
  const events = recording.timeline.events;
  const duration = Math.max(0, recording.timeline.duration || 0);
  const [currentTime, setCurrentTime] = useState(0);
  const currentTimeRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const wasPlayingBeforeScrub = useRef(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const infoID = useId();
  const infoButtonRef = useRef<HTMLButtonElement | null>(null);
  const infoPanelRef = useRef<HTMLDivElement | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [selectedPageId, setSelectedPageId] = useState<string | undefined>();
  const rootRef = useRef<HTMLElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const fullscreenSupported = typeof document !== "undefined" &&
    typeof document.exitFullscreen === "function" &&
    typeof HTMLElement !== "undefined" &&
    typeof HTMLElement.prototype.requestFullscreen === "function";
  const tweeEventTimes = useMemo(
    () => recording.format === "twee" ? recording.terminalEvents.map((event) => event.time) : [],
    [recording],
  );
  const counts = useMemo(
    () => events.reduce<Record<string, number>>((acc, event) => {
      const kind = eventKind(recording, event);
      acc[kind] = (acc[kind] ?? 0) + 1;
      return acc;
    }, {}),
    [events, recording],
  );
  const markers = useMemo(() => timelineMarkers(recording), [recording]);
  const ended = duration > 0 && currentTime >= duration;
  const title = displayTitle ?? recordingTitle(recording);

  const revealControls = useCallback(() => setControlsVisible(true), []);
  const beginScrubbing = useCallback(() => {
    wasPlayingBeforeScrub.current = playing;
    setPlaying(false);
    setScrubbing(true);
  }, [playing]);
  const endScrubbing = useCallback(() => {
    setScrubbing(false);
    if (wasPlayingBeforeScrub.current) setPlaying(true);
  }, []);

  const seek = useCallback((value: number) => {
    const next = Math.min(duration, Math.max(0, value));
    currentTimeRef.current = next;
    setCurrentTime(next);
  }, [duration]);

  useEffect(() => {
    currentTimeRef.current = 0;
    setCurrentTime(0);
    setPlaying(false);
    setSelectedPageId(undefined);
    setInfoOpen(false);
    setControlsVisible(true);
  }, [recording]);

  useEffect(() => {
    if (!playing || scrubbing || infoOpen) { setControlsVisible(true); return; }
    const timer = window.setTimeout(() => setControlsVisible(false), 1800);
    return () => window.clearTimeout(timer);
  }, [playing, scrubbing, infoOpen, currentTime]);

  useEffect(() => {
    if (!infoOpen) return;
    infoPanelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setInfoOpen(false); infoButtonRef.current?.focus(); }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!infoPanelRef.current?.contains(event.target as Node) && !infoButtonRef.current?.contains(event.target as Node)) {
        setInfoOpen(false);
        infoButtonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => { document.removeEventListener("keydown", onKeyDown); document.removeEventListener("pointerdown", onPointerDown); };
  }, [infoOpen]);

  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === rootRef.current);
    const reportFullscreenError = () => {
      setFullscreenError("Fullscreen is unavailable. Check your browser or embedding permissions.");
      syncFullscreen();
    };
    syncFullscreen();
    document.addEventListener("fullscreenchange", syncFullscreen);
    document.addEventListener("fullscreenerror", reportFullscreenError);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreen);
      document.removeEventListener("fullscreenerror", reportFullscreenError);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    setFullscreenError(null);
    const request = root.requestFullscreen;
    if (document.fullscreenElement === root) {
      try {
        void Promise.resolve(document.exitFullscreen()).catch(() => {
          setFullscreenError("Could not exit fullscreen.");
        });
      } catch {
        setFullscreenError("Could not exit fullscreen.");
      }
    } else if (typeof request === "function") {
      try {
        void Promise.resolve(request.call(root)).catch(() => {
          setFullscreenError("Fullscreen is unavailable. Check your browser or embedding permissions.");
        });
      } catch {
        setFullscreenError("Fullscreen is unavailable. Check your browser or embedding permissions.");
      }
    }
  }, []);

  useEffect(() => {
    if (!playing) return;
    let previous = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const elapsed = Math.max(0, now - previous);
      previous = now;
      const next = recording.format === "twee"
        ? advanceTweePlayhead(currentTimeRef.current, elapsed, tweeEventTimes, duration)
        : Math.min(duration, currentTimeRef.current + elapsed);
      currentTimeRef.current = next;
      setCurrentTime(next);
      if (next < duration) frame = window.requestAnimationFrame(tick);
      else setPlaying(false);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [duration, playing, recording.format, tweeEventTimes]);

  return (
    <section
      ref={rootRef}
      className={className}
      data-record-player-root
      data-record-player-state={playing ? (controlsVisible ? "playing-interacting" : "playing-idle") : ended ? "ended" : "paused"}
      onPointerMove={revealControls}
      onPointerDown={revealControls}
      onFocusCapture={revealControls}
      style={style}
    >
      <div data-record-player-presentation className="vrp-content">
        {recording.format === "twee" ? (
          <TerminalPresentation recording={recording} currentTime={currentTime} terminalFactory={terminalFactory} isFullscreen />
        ) : <BrowserPresentation recording={recording} currentTime={currentTime} selectedPageId={selectedPageId} onSelectPage={setSelectedPageId} isFullscreen />}
      </div>
      <div className={`vrp-chrome ${controlsVisible || !playing || scrubbing || infoOpen ? "vrp-chrome-visible" : ""}`}>
        <div className="vrp-top"><h2>{title}</h2><button ref={infoButtonRef} type="button" className="vrp-icon" aria-label="Recording information" aria-expanded={infoOpen} aria-controls={infoID} onClick={() => setInfoOpen((value) => !value)}>ⓘ</button></div>
        <button
          type="button"
          onClick={() => {
            if (ended) seek(0);
            setPlaying((value) => !value);
          }}
          className="vrp-play"
          aria-label={playing ? "Pause recording" : ended ? "Replay recording" : "Play recording"}
        >
          <span aria-hidden="true">{playing ? "❚❚" : ended ? "↻" : "▶"}</span>
        </button>
        <div className="vrp-bottom">
          <span>{formatClock(currentTime)}</span>
          <label className="vrp-scrubber">
          <input
            aria-label="Playback position"
            type="range"
            min={0}
            max={duration || 0}
            step={1}
            value={Math.min(currentTime, duration || 0)}
            onPointerDown={beginScrubbing}
            onFocus={revealControls}
            onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key) && !scrubbing) beginScrubbing(); }}
            onChange={(event) => seek(Number(event.currentTarget.value))}
            onPointerUp={endScrubbing}
            onKeyUp={endScrubbing}
          />
          {showTimeline ? <span className="vrp-markers" aria-label="recording timeline">{markers.map((event) => {
            const kind = eventKind(recording, event); return <i key={event.id} title={`${kind} ${formatMs(event.time)}`} style={{ left: `${duration ? (event.time / duration) * 100 : 0}%` }} />;
          })}</span> : null}
          </label><span>{formatClock(duration)}</span>
          {fullscreenSupported ? <button type="button" className="vrp-icon" onClick={toggleFullscreen} aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}>⛶</button> : null}
        </div>
      </div>
      {fullscreenError ? <div role="status" className="vrp-error">{fullscreenError}</div> : null}
      {infoOpen ? <div id={infoID} ref={infoPanelRef} role="dialog" aria-label="Recording information" tabIndex={-1} onKeyDown={(event) => { if (event.key === "Tab") { event.preventDefault(); infoPanelRef.current?.focus(); } }} className="vrp-info"><dl>
        <dt>Source</dt><dd>{recording.source || "—"}</dd><dt>Format</dt><dd>{recording.format}</dd><dt>Duration</dt><dd>{formatMs(duration)}</dd><dt>Files</dt><dd>{recording.metadata.fileCount}</dd><dt>Events</dt><dd>{recording.metadata.eventCount}</dd>
        {Object.entries(counts).map(([kind, count]) => <React.Fragment key={kind}><dt>{kind}</dt><dd>{count}</dd></React.Fragment>)}
        {recording.format === "twee" ? <><dt>Command</dt><dd>{recording.manifest.command.join(" ") || "—"}</dd><dt>Terminal</dt><dd>{recording.manifest.cols} × {recording.manifest.rows}</dd><dt>Input</dt><dd>{recording.terminalEvents.filter((event) => event.type === "input").length}</dd><dt>Resizes</dt><dd>{recording.terminalEvents.filter((event) => event.type === "resize").length}</dd><dt>Exit</dt><dd>{[...recording.terminalEvents].reverse().find((event) => event.type === "exit")?.type === "exit" ? ([...recording.terminalEvents].reverse().find((event) => event.type === "exit") as TweeEvent & { type: "exit" }).code : "not recorded"}</dd></> : <><dt>Screenshots</dt><dd>{recording.timeline.screenshots.length}</dd>{recording.format === "playwright" ? <><dt>Pages</dt><dd>{recording.pages.length}</dd><dt>Warnings</dt><dd>{recording.metadata.warnings.join("; ") || "none"}</dd></> : null}</>}
      </dl></div> : null}
      {showInspector ? <details className="vrp-inspector"><summary>Advanced inspector</summary>{recording.format === "twee" ? <TweeDetails recording={recording} /> : <ol>{recording.timeline.events.slice(0, 200).map((event) => <li key={event.id}>{formatMs(event.time)} {eventKind(recording, event)} {event.title ?? event.method ?? event.type ?? event.id}</li>)}</ol>}</details> : null}
    </section>
  );
}

export function RecordPlayerLoader({
  src,
  fetch,
  credentials = "same-origin",
  onReady,
  onError,
  loadingFallback = <div>Loading recording…</div>,
  errorFallback,
  ...playerProps
}: RecordPlayerLoaderProps) {
  const [recording, setRecording] = useState<LoadedRecording | null>(null);
  const [error, setError] = useState<PlayerError | Error | null>(null);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onReadyRef.current = onReady;
    onErrorRef.current = onError;
  }, [onReady, onError]);

  useEffect(() => {
    const abort = new AbortController();
    setRecording(null);
    setError(null);

    loadRecording(src, { fetch, credentials, signal: abort.signal })
      .then((loaded) => {
        if (abort.signal.aborted) return;
        setRecording(loaded);
        onReadyRef.current?.(loaded);
      })
      .catch((err) => {
        if (abort.signal.aborted) return;
        const nextError = err instanceof Error ? err : new Error(String(err));
        setError(nextError);
        onErrorRef.current?.(nextError);
      });

    return () => abort.abort();
  }, [src, fetch, credentials]);

  if (error) return <>{errorFallback ? errorFallback(error) : <div role="alert">Failed to load recording: {error.message}</div>}</>;
  if (!recording) return <>{loadingFallback}</>;
  return <RecordPlayer recording={recording} {...playerProps} />;
}
