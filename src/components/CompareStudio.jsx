import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import RecordStudio from "./RecordStudio";

const brand = {
  orange: "#f97316",
  amber: "#f59e0b",
};

const darkSurface = {
  bg: "#0c0c0c",
  bgCard: "#161616",
  bgPanel: "#1a1a1a",
  border: "#2a2a2a",
  text: "#e2e2e2",
  textMid: "#999",
  textDim: "#666",
};

const lightSurface = {
  bg: "#f8f8f8",
  bgCard: "#ffffff",
  bgPanel: "#f0f0f0",
  border: "#e0e0e0",
  text: "#1a1a1a",
  textMid: "#555",
  textDim: "#888",
};

function fmt(ms) {
  if (ms == null || isNaN(ms) || ms < 0) return "0:00.00";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  const frac = Math.floor((ms % 1000) / 10);
  return `${m}:${String(sec).padStart(2, "0")}.${String(frac).padStart(2, "0")}`;
}

export default function CompareStudio() {
  const [dark, setDark] = useState(true);
  const [leftFile, setLeftFile] = useState(null);
  const [rightFile, setRightFile] = useState(null);

  // Shared playback state (driven from refs)
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [duration, setDuration] = useState(0);

  const leftRef = useRef(null);
  const rightRef = useRef(null);
  const pollRef = useRef(null);

  const V = useMemo(() => ({ ...brand, ...(dark ? darkSurface : lightSurface) }), [dark]);

  const bothLoaded = leftFile && rightFile;

  // Poll playhead from left player to keep shared display in sync
  useEffect(() => {
    if (!bothLoaded) return;
    const poll = () => {
      const ls = leftRef.current?.getState?.();
      if (ls) {
        setPlayhead(ls.playhead);
        setIsPlaying(ls.isPlaying);
        setDuration(Math.max(ls.duration, rightRef.current?.getState?.()?.duration || 0));
      }
      pollRef.current = requestAnimationFrame(poll);
    };
    pollRef.current = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(pollRef.current);
  }, [bothLoaded]);

  // Shared control helpers
  const both = (fn) => { fn(leftRef.current); fn(rightRef.current); };

  const togglePlay = () => {
    both((r) => r?.togglePlay?.());
  };
  const goToStart = () => {
    both((r) => r?.goToStart?.());
  };
  const goToEnd = () => {
    both((r) => r?.goToEnd?.());
  };
  const changeSpeed = (s) => {
    setSpeed(s);
    both((r) => r?.setSpeed?.(s));
  };
  const toggleLoop = () => {
    const next = !loop;
    setLoop(next);
    both((r) => r?.setLoop?.(next));
  };

  const handleDrop = useCallback((side) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      if (side === "left") setLeftFile(file);
      else setRightFile(file);
    }
  }, []);

  const handleFileInput = useCallback((side) => (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (side === "left") setLeftFile(file);
      else setRightFile(file);
    }
  }, []);

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const reset = () => {
    setLeftFile(null);
    setRightFile(null);
    setPlayhead(0);
    setIsPlaying(false);
  };

  // Landing page with two drop zones
  if (!bothLoaded) {
    return (
      <div
        style={{
          width: "100%",
          height: "100vh",
          background: V.bg,
          color: V.text,
          fontFamily: "'SF Mono', 'Fira Code', monospace",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 24,
        }}
      >
        <button
          onClick={() => setDark(!dark)}
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            background: V.bgCard,
            border: `1px solid ${V.border}`,
            color: V.textMid,
            cursor: "pointer",
            padding: "5px 10px",
            borderRadius: 6,
            fontSize: 15,
            fontFamily: "inherit",
          }}
        >
          {dark ? "☀︎" : "☾"}
        </button>

        <a
          href="/"
          style={{
            position: "absolute",
            top: 16,
            left: 16,
            color: V.orange,
            textDecoration: "none",
            fontSize: 14,
            fontFamily: "inherit",
          }}
        >
          ← Back to Player
        </a>

        <div style={{ fontSize: 24, fontWeight: 700, color: V.orange }}>
          Side-by-Side Compare
        </div>
        <div style={{ fontSize: 14, color: V.textDim, marginTop: -12 }}>
          Upload two recordings to compare expected vs. actual
        </div>

        <div style={{ display: "flex", gap: 32, flexWrap: "wrap", justifyContent: "center" }}>
          <DropZone
            label="Expected (Golden)"
            file={leftFile}
            onDrop={handleDrop("left")}
            onDragOver={handleDragOver}
            onFileInput={handleFileInput("left")}
            onClear={() => setLeftFile(null)}
            V={V}
          />
          <DropZone
            label="Actual (Test)"
            file={rightFile}
            onDrop={handleDrop("right")}
            onDragOver={handleDragOver}
            onFileInput={handleFileInput("right")}
            onClear={() => setRightFile(null)}
            V={V}
          />
        </div>

        <div style={{ fontSize: 13, color: V.textDim, marginTop: 8 }}>
          Drop <code style={{ background: V.bgCard, padding: "1px 4px", borderRadius: 3, color: V.amber }}>record.zip</code> files into each zone, then compare
        </div>
      </div>
    );
  }

  // Side-by-side view with shared controls
  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: V.bg,
        fontFamily: "'SF Mono', 'Fira Code', monospace",
      }}
    >
      {/* Shared control bar */}
      <div
        style={{
          height: 48,
          background: V.bgCard,
          borderBottom: `1px solid ${V.border}`,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          gap: 10,
          flexShrink: 0,
        }}
      >
        <a
          href="/"
          style={{
            color: V.orange,
            textDecoration: "none",
            fontSize: 13,
            fontFamily: "inherit",
          }}
        >
          ← Player
        </a>
        <span style={{ fontSize: 14, fontWeight: 700, color: V.orange }}>Compare</span>

        <div style={{ width: 1, height: 20, background: V.border, margin: "0 4px" }} />

        {/* Transport controls */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            background: V.bgPanel,
            border: `1px solid ${V.border}`,
            borderRadius: 10,
            padding: "2px 4px",
          }}
        >
          <button
            onClick={goToStart}
            style={{
              background: "none",
              border: "none",
              color: V.textDim,
              cursor: "pointer",
              padding: "3px 8px",
              borderRadius: 6,
              fontSize: 18,
              outline: "none",
            }}
          >
            ⏮
          </button>
          <button
            onClick={togglePlay}
            style={{
              background: isPlaying ? V.orange : "none",
              border: "none",
              color: isPlaying ? "#fff" : V.textDim,
              cursor: "pointer",
              width: 42,
              height: 32,
              borderRadius: 8,
              fontSize: 20,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              outline: "none",
            }}
          >
            {isPlaying ? "⏸" : "▶"}
          </button>
          <button
            onClick={goToEnd}
            style={{
              background: "none",
              border: "none",
              color: V.textDim,
              cursor: "pointer",
              padding: "3px 8px",
              borderRadius: 6,
              fontSize: 18,
              outline: "none",
            }}
          >
            ⏭
          </button>
          <div style={{ width: 1, height: 16, background: V.border, margin: "0 2px" }} />
          <button
            onClick={toggleLoop}
            title={loop ? "Loop on" : "Loop off"}
            style={{
              background: loop ? V.orange + "18" : "none",
              border: loop ? `1px solid ${V.orange}40` : "1px solid transparent",
              color: loop ? V.orange : V.textDim,
              cursor: "pointer",
              padding: "3px 8px",
              borderRadius: 6,
              fontSize: 18,
              fontWeight: 700,
              outline: "none",
            }}
          >
        ⟲
          </button>
          <div style={{ width: 1, height: 16, background: V.border, margin: "0 2px" }} />
          <button
            onClick={() => setOverlayEnabled((v) => !v)}
            title={overlayEnabled ? "Disable highlight" : "Enable highlight"}
            style={{
              background: overlayEnabled ? V.orange + "18" : "none",
              border: overlayEnabled ? `1px solid ${V.orange}40` : "1px solid transparent",
              color: overlayEnabled ? V.orange : V.textDim,
              cursor: "pointer",
              padding: "3px 8px",
              borderRadius: 6,
              fontSize: 20,
              fontWeight: 700,
              outline: "none",
            }}
          >
            🔦
          </button>
        </div>

        {/* Time display */}
        <div
          style={{
            fontVariantNumeric: "tabular-nums",
            fontSize: 16,
            fontWeight: 600,
            background: V.bg,
            border: `1px solid ${V.border}`,
            borderRadius: 6,
            padding: "3px 10px",
            minWidth: 80,
            textAlign: "center",
            color: V.orange,
          }}
        >
          {fmt(playhead)}
        </div>
        <span style={{ color: V.textDim, fontSize: 13 }}>/ {fmt(duration)}</span>

        {/* Speed */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            background: V.bgPanel,
            border: `1px solid ${V.border}`,
            borderRadius: 6,
            padding: "3px 8px",
          }}
        >
          <input
            type="range"
            min={0.1}
            max={5}
            step={0.1}
            value={speed}
            onChange={(e) => changeSpeed(parseFloat(e.target.value))}
            style={{ width: 48, accentColor: V.orange, height: 2, cursor: "pointer", outline: "none" }}
          />
          <span
            style={{
              fontSize: 11,
              color: speed === 1 ? V.textDim : V.orange,
              fontVariantNumeric: "tabular-nums",
              minWidth: 28,
              textAlign: "center",
              fontWeight: speed !== 1 ? 700 : 400,
            }}
          >
            {speed.toFixed(1)}×
          </span>
        </div>

        <div style={{ flex: 1 }} />

        {/* Labels */}
        <span style={{ fontSize: 12, color: V.textDim, padding: "2px 8px", background: V.bgPanel, borderRadius: 4, border: `1px solid ${V.border}` }}>
          ◀ Expected
        </span>
        <span style={{ fontSize: 12, color: V.textDim, padding: "2px 8px", background: V.bgPanel, borderRadius: 4, border: `1px solid ${V.border}` }}>
          Actual ▶
        </span>

        <button
          onClick={reset}
          style={{
            background: V.bgPanel,
            border: `1px solid ${V.border}`,
            color: V.textMid,
            cursor: "pointer",
            padding: "3px 10px",
            borderRadius: 4,
            fontSize: 12,
            fontFamily: "inherit",
          }}
        >
          ⏏ Reset
        </button>
        <button
          onClick={() => setDark(!dark)}
          style={{
            background: "none",
            border: `1px solid ${V.border}`,
            color: V.textMid,
            cursor: "pointer",
            padding: "3px 8px",
            borderRadius: 4,
            fontSize: 14,
            fontFamily: "inherit",
          }}
        >
          {dark ? "☀︎" : "☾"}
        </button>
      </div>

      {/* Two players side-by-side */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
        <div style={{ flex: 1, borderRight: `1px solid ${V.border}`, overflow: "hidden" }}>
          <RecordStudio
            ref={leftRef}
            initialFile={leftFile}
            forceLayout="stacked"
            label="Expected"
            hideGlobalChrome
            hideControls
          />
        </div>
        <div style={{ flex: 1, overflow: "hidden" }}>
          <RecordStudio
            ref={rightRef}
            initialFile={rightFile}
            forceLayout="stacked"
            label="Actual"
            hideGlobalChrome
            hideControls
          />
        </div>
      </div>
    </div>
  );
}

function DropZone({ label, file, onDrop, onDragOver, onFileInput, onClear, V }) {
  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      style={{
        width: 280,
        padding: 24,
        border: `2px dashed ${file ? V.orange + "60" : V.border}`,
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        background: file ? V.orange + "08" : V.bgCard,
        transition: "all 0.2s",
        position: "relative",
      }}
      onMouseEnter={(e) => { if (!file) e.currentTarget.style.borderColor = V.orange; }}
      onMouseLeave={(e) => { if (!file) e.currentTarget.style.borderColor = V.border; }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: V.orange, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      {file ? (
        <>
          <div style={{ fontSize: 28, opacity: 0.5 }}>✅</div>
          <div style={{ fontSize: 13, color: V.textMid, textAlign: "center", wordBreak: "break-all" }}>
            {file.name}
          </div>
          <button
            onClick={onClear}
            style={{
              background: "none",
              border: `1px solid ${V.border}`,
              color: V.textDim,
              cursor: "pointer",
              padding: "2px 8px",
              borderRadius: 4,
              fontSize: 11,
              fontFamily: "inherit",
            }}
          >
            Change
          </button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 28, opacity: 0.3 }}>📁</div>
          <div style={{ color: V.textDim, fontSize: 13 }}>Drop zip or click to browse</div>
          <input
            type="file"
            accept=".zip"
            onChange={onFileInput}
            style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
          />
        </>
      )}
    </div>
  );
}
