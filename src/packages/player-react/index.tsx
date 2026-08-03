import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  loadRecording,
  type LoadedRecording,
  type LoadRecordingOptions,
  PlayerError,
  type TweeEvent,
  type TweeRecording,
  type VibiumRecording,
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

function optionVisible(
  value: boolean | "visible" | "hidden" | undefined,
  defaultValue = true,
): boolean {
  if (value === "hidden") return false;
  if (value === "visible") return true;
  return value ?? defaultValue;
}

function eventKind(recording: LoadedRecording, event: LoadedRecording["timeline"]["events"][number]): string {
  return recording.format === "vibium"
    ? (event as VibiumRecording["timeline"]["events"][number]).kind
    : (event as TweeEvent).type;
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
  if (recording.format === "vibium") return events.slice(0, 250);

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

function VibiumPresentation({
  recording,
  currentTime,
  isFullscreen = false,
}: {
  recording: VibiumRecording;
  currentTime: number;
  isFullscreen?: boolean;
}) {
  const screenshots = useMemo(
    () => recording.timeline.screenshots.filter((screenshot) => screenshot.dataUrl),
    [recording.timeline.screenshots],
  );
  const currentScreenshot = useMemo(() => {
    if (!screenshots.length) return undefined;
    return screenshots.reduce(
      (current, screenshot) => (screenshot.time <= currentTime ? screenshot : current),
      screenshots[0],
    );
  }, [currentTime, screenshots]);

  if (!currentScreenshot?.dataUrl) return null;
  return (
    <figure
      data-testid="screenshot-presentation"
      style={{
        margin: isFullscreen ? 0 : "16px 0",
        border: "1px solid #d7dce3",
        borderRadius: 8,
        overflow: "hidden",
        ...(isFullscreen ? { display: "flex", flex: "1 1 0", minHeight: 0, flexDirection: "column" as const } : {}),
      }}
    >
      <img
        src={currentScreenshot.dataUrl}
        alt="Current recording screenshot"
        style={{
          display: "block",
          width: "100%",
          maxHeight: isFullscreen ? "none" : 420,
          height: isFullscreen ? "100%" : undefined,
          flex: isFullscreen ? "1 1 0" : undefined,
          minHeight: 0,
          objectFit: "contain",
          background: "#101419",
        }}
      />
      <figcaption style={{ padding: 8, fontSize: 12, color: "#5f6b7a" }}>
        Screenshot at {formatMs(currentScreenshot.time)}
      </figcaption>
    </figure>
  );
}

function TweeDetails({ recording, isFullscreen = false }: { recording: TweeRecording; isFullscreen?: boolean }) {
  const detailEvents = recording.terminalEvents.filter((event) => event.type !== "output");
  const resizeCount = recording.terminalEvents.filter((event) => event.type === "resize").length;
  const inputCount = recording.terminalEvents.filter((event) => event.type === "input").length;
  const exit = [...recording.terminalEvents].reverse().find((event) => event.type === "exit");

  return (
    <div style={{ marginTop: 16, border: "1px solid #d7dce3", borderRadius: 8, overflow: "auto", maxHeight: isFullscreen ? 180 : undefined, flexShrink: 0 }}>
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

  const seek = useCallback((value: number) => {
    const next = Math.min(duration, Math.max(0, value));
    currentTimeRef.current = next;
    setCurrentTime(next);
  }, [duration]);

  useEffect(() => {
    currentTimeRef.current = 0;
    setCurrentTime(0);
    setPlaying(false);
  }, [recording]);

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
      style={{
        boxSizing: "border-box",
        width: "100%",
        maxWidth: isFullscreen ? "none" : "100%",
        height: isFullscreen ? "100%" : undefined,
        overflow: isFullscreen ? "hidden" : "hidden",
        padding: 16,
        borderRadius: isFullscreen ? 0 : 8,
        background: "#ffffff",
        fontFamily: "system-ui, sans-serif",
        color: "#172033",
        display: isFullscreen ? "flex" : undefined,
        flexDirection: isFullscreen ? "column" : undefined,
        ...style,
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "baseline", minWidth: 0 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>Record Player</h2>
          <div style={{ color: "#5f6b7a", fontSize: 13, overflowWrap: "anywhere" }}>
            {recording.source ? `${recording.source} · ` : ""}
            <strong>{recording.format === "twee" ? "Twee" : "Vibium"}</strong>
            {` · ${recording.metadata.fileCount} files · ${recording.metadata.eventCount} events · ${formatMs(duration)}`}
          </div>
        </div>
        <div aria-label="event counts" style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", minWidth: 0 }}>
          {Object.entries(counts).map(([kind, count]) => (
            <span key={kind} style={{ border: "1px solid #d7dce3", borderRadius: 999, padding: "2px 8px", fontSize: 12, whiteSpace: "nowrap" }}>
              {kind}: {count}
            </span>
          ))}
        </div>
      </header>

      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "16px 0", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => {
            if (duration > 0 && currentTime >= duration) seek(0);
            setPlaying((value) => !value);
          }}
          aria-label={playing ? "Pause recording" : "Play recording"}
          style={{
            border: "1px solid #1f2937",
            borderRadius: 999,
            background: "#172033",
            color: "#ffffff",
            cursor: "pointer",
            fontWeight: 700,
            padding: "8px 16px",
            display: "grid",
            justifyItems: "center",
          }}
        >
          <span aria-hidden={!playing} style={{ gridArea: "1 / 1", visibility: playing ? "visible" : "hidden" }}>
            ❚❚ Pause
          </span>
          <span aria-hidden={playing} style={{ gridArea: "1 / 1", visibility: playing ? "hidden" : "visible" }}>
            ▶ Play
          </span>
        </button>
        {fullscreenSupported ? (
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            style={{
              border: "1px solid #64748b", borderRadius: 999, background: "#ffffff", color: "#172033",
              cursor: "pointer", fontWeight: 600, padding: "8px 12px",
            }}
          >
            {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          </button>
        ) : null}
        <label style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 260px", minWidth: 0, fontSize: 13, color: "#5f6b7a" }}>
          <span
            style={{
              width: `${formatMs(duration).length}ch`,
              textAlign: "right",
              fontVariantNumeric: "tabular-nums",
              flexShrink: 0,
            }}
          >
            {formatMs(currentTime)}
          </span>
          <input
            aria-label="Playback position"
            type="range"
            min={0}
            max={duration || 0}
            step={1}
            value={Math.min(currentTime, duration || 0)}
            onChange={(event) => seek(Number(event.currentTarget.value))}
            style={{ flex: "1 1 auto", minWidth: 120 }}
          />
          <span>{formatMs(duration)}</span>
        </label>
      </div>

      {fullscreenError ? <div role="status" aria-live="polite" style={{ color: "#b42318", fontSize: 13, marginBottom: 8 }}>{fullscreenError}</div> : null}

      <div data-record-player-presentation style={isFullscreen ? { display: "flex", flex: "1 1 0", minHeight: 0 } : undefined}>
        {recording.format === "twee" ? (
          <TerminalPresentation
            recording={recording}
            currentTime={currentTime}
            terminalFactory={terminalFactory}
            isFullscreen={isFullscreen}
            style={isFullscreen ? { flex: "1 1 0", minHeight: 0 } : undefined}
          />
        ) : (
          <VibiumPresentation recording={recording} currentTime={currentTime} isFullscreen={isFullscreen} />
        )}
      </div>

      {showTimeline ? (
        <div aria-label="recording timeline" style={{ margin: "16px 0", flexShrink: 0 }}>
          <div style={{ height: 8, borderRadius: 999, background: "#edf1f7", position: "relative" }}>
            {markers.map((event) => {
              const kind = eventKind(recording, event);
              return (
                <span
                  key={event.id}
                  title={`${kind} ${formatMs(event.time)}`}
                  style={{
                    position: "absolute",
                    left: `${duration ? (event.time / duration) * 100 : 0}%`,
                    top: -4,
                    width: 4,
                    height: 16,
                    borderRadius: 2,
                    background: kind === "action" || kind === "input" ? "#f97316" : kind === "network" || kind === "resize" ? "#2563eb" : kind === "console" || kind === "exit" ? "#7c3aed" : "#64748b",
                  }}
                />
              );
            })}
          </div>
        </div>
      ) : null}

      {showInspector ? (
        recording.format === "twee" ? (
          <TweeDetails recording={recording} isFullscreen={isFullscreen} />
        ) : (
          <div style={{ border: "1px solid #d7dce3", borderRadius: 8, overflow: "hidden", maxHeight: isFullscreen ? 180 : undefined, flexShrink: 0 }}>
            <div style={{ padding: "8px 12px", background: "#f8fafc", fontWeight: 600 }}>Events</div>
            <ol style={{ margin: 0, padding: 0, listStyle: "none", maxHeight: 360, overflow: "auto" }}>
              {recording.timeline.events.slice(0, 200).map((event) => (
                <li
                  key={event.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "90px 90px minmax(0, 1fr)",
                    gap: 8,
                    padding: "8px 12px",
                    borderTop: "1px solid #edf1f7",
                    fontSize: 13,
                    minWidth: 0,
                  }}
                >
                  <time>{formatMs(event.time)}</time>
                  <span>{event.kind}</span>
                  <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{event.title ?? event.method ?? event.type ?? event.id}</span>
                </li>
              ))}
            </ol>
          </div>
        )
      ) : null}
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
