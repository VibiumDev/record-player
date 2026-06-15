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
  const firstScreenshot = recording.timeline.screenshots.find((screenshot) => screenshot.dataUrl);
  const counts = useMemo(
    () =>
      events.reduce<Record<string, number>>((acc, event) => {
        acc[event.kind] = (acc[event.kind] ?? 0) + 1;
        return acc;
      }, {}),
    [events],
  );

  return (
    <section className={className} style={{ fontFamily: "system-ui, sans-serif", color: "#172033", ...style }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "baseline" }}>
        <div>
          <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>Vibium Record Player</h2>
          <div style={{ color: "#5f6b7a", fontSize: 13 }}>
            {recording.source ? `${recording.source} · ` : ""}
            {recording.metadata.fileCount} files · {recording.metadata.eventCount} events · {formatMs(recording.timeline.duration)}
          </div>
        </div>
        <div aria-label="event counts" style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {Object.entries(counts).map(([kind, count]) => (
            <span key={kind} style={{ border: "1px solid #d7dce3", borderRadius: 999, padding: "2px 8px", fontSize: 12 }}>
              {kind}: {count}
            </span>
          ))}
        </div>
      </header>

      {firstScreenshot?.dataUrl ? (
        <figure style={{ margin: "16px 0", border: "1px solid #d7dce3", borderRadius: 8, overflow: "hidden" }}>
          <img src={firstScreenshot.dataUrl} alt="First recording screenshot" style={{ display: "block", width: "100%", maxHeight: 420, objectFit: "contain", background: "#101419" }} />
          <figcaption style={{ padding: 8, fontSize: 12, color: "#5f6b7a" }}>Screenshot at {formatMs(firstScreenshot.time)}</figcaption>
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
              <li key={event.id} style={{ display: "grid", gridTemplateColumns: "90px 90px 1fr", gap: 8, padding: "8px 12px", borderTop: "1px solid #edf1f7", fontSize: 13 }}>
                <time>{formatMs(event.time)}</time>
                <span>{event.kind}</span>
                <span>{event.title ?? event.method ?? event.type ?? event.id}</span>
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
