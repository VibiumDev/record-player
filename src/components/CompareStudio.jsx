import { useState, useRef, useCallback, useMemo } from "react";
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

export default function CompareStudio() {
  const [dark, setDark] = useState(true);
  const [leftFile, setLeftFile] = useState(null);
  const [rightFile, setRightFile] = useState(null);

  const V = useMemo(() => ({ ...brand, ...(dark ? darkSurface : lightSurface) }), [dark]);

  const bothLoaded = leftFile && rightFile;

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
          {/* Left drop zone */}
          <DropZone
            label="Expected (Golden)"
            file={leftFile}
            onDrop={handleDrop("left")}
            onDragOver={handleDragOver}
            onFileInput={handleFileInput("left")}
            onClear={() => setLeftFile(null)}
            V={V}
          />

          {/* Right drop zone */}
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

  // Side-by-side view
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
      {/* Shared header */}
      <div
        style={{
          height: 36,
          background: V.bgCard,
          borderBottom: `1px solid ${V.border}`,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          gap: 12,
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
        <span style={{ fontSize: 14, fontWeight: 700, color: V.orange }}>Compare Mode</span>
        <div style={{ flex: 1 }} />
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
            initialFile={leftFile}
            forceLayout="stacked"
            label="Expected"
            hideGlobalChrome
          />
        </div>
        <div style={{ flex: 1, overflow: "hidden" }}>
          <RecordStudio
            initialFile={rightFile}
            forceLayout="stacked"
            label="Actual"
            hideGlobalChrome
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
