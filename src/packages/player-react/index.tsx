import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadRecording, type LoadedRecording, type LoadRecordingOptions, PlayerError } from "../player-core";

export interface RecordPlayerProps {
  recording: LoadedRecording;
  inspector?: boolean | "visible" | "hidden";
  timeline?: boolean | "visible" | "hidden";
  className?: string;
  style?: React.CSSProperties;
  storageKey?: string | false;
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

function optionVisible(value: boolean | "visible" | "hidden" | undefined, defaultValue = true): boolean {
  if (value === "hidden") return false;
  if (value === "visible") return true;
  return value ?? defaultValue;
}

export function RecordPlayer({ recording, inspector = true, timeline = true, className, style }: RecordPlayerProps) {
  const showInspector = optionVisible(inspector);
  const showTimeline = optionVisible(timeline);
  const events = recording.timeline.events;
  const screenshots = useMemo(() => recording.timeline.screenshots.filter((screenshot) => screenshot.dataUrl), [recording.timeline.screenshots]);
  const duration = Math.max(0, recording.timeline.duration || 0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const currentScreenshot = useMemo(() => {
    if (!screenshots.length) return undefined;
    return screenshots.reduce((current, screenshot) => (screenshot.time <= currentTime ? screenshot : current), screenshots[0]);
  }, [currentTime, screenshots]);
  const counts = useMemo(
    () =>
      events.reduce<Record<string, number>>((acc, event) => {
        acc[event.kind] = (acc[event.kind] ?? 0) + 1;
        return acc;
      }, {}),
    [events],
  );

  useEffect(() => {
    setCurrentTime(0);
    setPlaying(false);
  }, [recording]);

  useEffect(() => {
    if (!playing) return;
    const startedAt = performance.now();
    const initialTime = currentTime;
    const interval = window.setInterval(() => {
      setCurrentTime(() => {
        const next = Math.min(duration, initialTime + performance.now() - startedAt);
        if (next >= duration) {
          window.clearInterval(interval);
          setPlaying(false);
        }
        return next;
      });
    }, 100);
    return () => window.clearInterval(interval);
  }, [currentTime, duration, playing]);

  const seek = (value: number) => {
    setCurrentTime(Math.min(duration, Math.max(0, value)));
  };

  return (
    <section
      className={className}
      style={{
        boxSizing: "border-box",
        width: "100%",
        maxWidth: "100%",
        overflow: "hidden",
        padding: 16,
        borderRadius: 8,
        background: "#ffffff",
        fontFamily: "system-ui, sans-serif",
        color: "#172033",
        ...style,
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "baseline", minWidth: 0 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>Vibium Record Player</h2>
          <div style={{ color: "#5f6b7a", fontSize: 13, overflowWrap: "anywhere" }}>
            {recording.source ? `${recording.source} · ` : ""}
            {recording.metadata.fileCount} files · {recording.metadata.eventCount} events · {formatMs(recording.timeline.duration)}
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

      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "16px 0 0", flexWrap: "wrap" }}>
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
          }}
        >
          {playing ? "❚❚ Pause" : "▶ Play"}
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 260px", minWidth: 0, fontSize: 13, color: "#5f6b7a" }}>
          {/* Reserve the width of the widest label (the formatted duration) so
              the flexed slider's geometry stays fixed while time advances. */}
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
            step={100}
            value={Math.min(currentTime, duration || 0)}
            onChange={(event) => seek(Number(event.currentTarget.value))}
            style={{ flex: "1 1 auto", minWidth: 120 }}
          />
          <span>{formatMs(duration)}</span>
        </label>
      </div>

      {currentScreenshot?.dataUrl ? (
        <figure style={{ margin: "16px 0", border: "1px solid #d7dce3", borderRadius: 8, overflow: "hidden" }}>
          <img src={currentScreenshot.dataUrl} alt="Current recording screenshot" style={{ display: "block", width: "100%", maxHeight: 420, objectFit: "contain", background: "#101419" }} />
          <figcaption style={{ padding: 8, fontSize: 12, color: "#5f6b7a" }}>Screenshot at {formatMs(currentScreenshot.time)}</figcaption>
        </figure>
      ) : null}

      {showTimeline ? (
        <div aria-label="recording timeline" style={{ margin: "16px 0" }}>
          <div style={{ height: 8, borderRadius: 999, background: "#edf1f7", position: "relative" }}>
            {events.slice(0, 250).map((event) => (
              <span
                key={event.id}
                title={`${event.title ?? event.type ?? event.kind} ${formatMs(event.time)}`}
                style={{
                  position: "absolute",
                  left: `${recording.timeline.duration ? (event.time / recording.timeline.duration) * 100 : 0}%`,
                  top: -4,
                  width: 4,
                  height: 16,
                  borderRadius: 2,
                  background: event.kind === "action" ? "#f97316" : event.kind === "network" ? "#2563eb" : event.kind === "console" ? "#7c3aed" : "#64748b",
                }}
              />
            ))}
          </div>
        </div>
      ) : null}

      {showInspector ? (
        <div style={{ border: "1px solid #d7dce3", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "8px 12px", background: "#f8fafc", fontWeight: 600 }}>Events</div>
          <ol style={{ margin: 0, padding: 0, listStyle: "none", maxHeight: 360, overflow: "auto" }}>
            {events.slice(0, 200).map((event) => (
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
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        onErrorRef.current?.(error);
      });

    return () => abort.abort();
  }, [src, fetch, credentials]);

  if (error) return <>{errorFallback ? errorFallback(error) : <div role="alert">Failed to load recording: {error.message}</div>}</>;
  if (!recording) return <>{loadingFallback}</>;
  return <RecordPlayer recording={recording} {...playerProps} />;
}
