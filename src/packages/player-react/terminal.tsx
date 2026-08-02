import React, { useEffect, useMemo, useRef, useState } from "react";

import type { TweeRecording } from "../player-core";
import {
  createGhosttyTerminal,
  type GhosttyTerminal,
} from "../ghostty-browser";

export type GhosttyTerminalFactory = (
  cols: number,
  rows: number,
) => Promise<GhosttyTerminal>;

export interface TerminalPresentationProps {
  recording: TweeRecording;
  currentTime: number;
  terminalFactory?: GhosttyTerminalFactory;
  className?: string;
  style?: React.CSSProperties;
}

interface PlaybackSession {
  terminal: GhosttyTerminal;
  recording: TweeRecording;
  nextEventIndex: number;
  appliedTime: number;
  animationFrame: number | null;
  disposed: boolean;
}

const defaultTerminalFactory: GhosttyTerminalFactory = (cols, rows) =>
  createGhosttyTerminal(cols, rows);

const jetBrainsMonoURL = new URL("./fonts/JetBrainsMono-Regular.ttf", import.meta.url).href;
const notoSansMonoURL = new URL("./fonts/NotoSansMono-Regular.ttf", import.meta.url).href;
const notoSansSymbolsURL = new URL("./fonts/NotoSansSymbols-Regular.ttf", import.meta.url).href;
const notoSansSymbols2URL = new URL("./fonts/NotoSansSymbols2-Regular.ttf", import.meta.url).href;

const terminalFont =
  "'Record Player JetBrains Mono', 'Record Player Noto Sans Mono', " +
  "'Record Player Noto Sans Symbols', 'Record Player Noto Sans Symbols 2', monospace";

const terminalFontFaces = `
@font-face {
  font-family: "Record Player JetBrains Mono";
  src: url("${jetBrainsMonoURL}") format("truetype");
  font-display: block;
}
@font-face {
  font-family: "Record Player Noto Sans Mono";
  src: url("${notoSansMonoURL}") format("truetype");
  font-display: block;
}
@font-face {
  font-family: "Record Player Noto Sans Symbols";
  src: url("${notoSansSymbolsURL}") format("truetype");
  font-display: block;
}
@font-face {
  font-family: "Record Player Noto Sans Symbols 2";
  src: url("${notoSansSymbols2URL}") format("truetype");
  font-display: block;
}`;

const allowedElements = new Set([
  "pre",
  "div",
  "span",
  "code",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "br",
]);

const droppedSubtrees = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "svg",
  "math",
  "template",
  "noscript",
  "meta",
  "link",
  "img",
  "video",
  "audio",
  "source",
  "form",
  "input",
  "button",
  "select",
  "textarea",
]);

function requestTerminalFrame(callback: FrameRequestCallback): number {
  if (typeof window.requestAnimationFrame === "function") {
    return window.requestAnimationFrame(callback);
  }
  return window.setTimeout(() => callback(performance.now()), 16);
}

function cancelTerminalFrame(frame: number): void {
  if (typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(frame);
  } else {
    window.clearTimeout(frame);
  }
}

function isPaletteProperty(property: string): boolean {
  const match = /^--vt-palette-(\d{1,3})$/.exec(property);
  return Boolean(match && Number(match[1]) <= 255);
}

function nativeTweePalette(): Record<string, string> {
  const values = [
    [0, 0, 0], [178, 24, 24], [24, 178, 24], [178, 178, 24],
    [24, 24, 178], [178, 24, 178], [24, 178, 178], [200, 200, 200],
    [100, 100, 100], [255, 60, 60], [60, 255, 60], [255, 255, 60],
    [60, 60, 255], [255, 60, 255], [60, 255, 255], [255, 255, 255],
  ];
  for (let index = 16; index < 232; index += 1) {
    const value = index - 16;
    const component = (part: number) => part === 0 ? 0 : 55 + 40 * part;
    values.push([
      component(Math.floor(value / 36)),
      component(Math.floor(value / 6) % 6),
      component(value % 6),
    ]);
  }
  for (let index = 232; index < 256; index += 1) {
    const value = 8 + (index - 232) * 10;
    values.push([value, value, value]);
  }

  return Object.fromEntries(
    values.map(([red, green, blue], index) => [
      `--vt-palette-${index}`,
      `rgb(${red}, ${green}, ${blue})`,
    ]),
  );
}

const nativePalette = nativeTweePalette();
const nativeDefaultForeground = "rgb(200, 200, 200)";
const nativeDefaultBackground = "rgb(0, 0, 0)";

function safeColor(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  const paletteReference = /^var\(--vt-palette-(\d{1,3})\)$/.exec(normalized);
  return (
    /^#[0-9a-f]{3,8}$/.test(normalized) ||
    /^(?:rgb|rgba|hsl|hsla)\([\d\s.,%+\-/]+\)$/.test(normalized) ||
    /^(?:black|white|transparent|currentcolor)$/.test(normalized) ||
    Boolean(paletteReference && Number(paletteReference[1]) <= 255)
  );
}

function dimNativeColor(value: string): string {
  const normalized = value.trim().toLowerCase();
  const paletteReference = /^var\(--vt-palette-(\d{1,3})\)$/.exec(normalized);
  const resolved = paletteReference
    ? nativePalette[`--vt-palette-${Number(paletteReference[1])}`]
    : normalized;
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(resolved);
  if (rgb) {
    return `rgb(${Math.floor(Number(rgb[1]) / 2)}, ${Math.floor(Number(rgb[2]) / 2)}, ${Math.floor(Number(rgb[3]) / 2)})`;
  }
  const hex = /^#([0-9a-f]{6})$/.exec(resolved);
  if (hex) {
    const packed = Number.parseInt(hex[1], 16);
    return `rgb(${Math.floor(((packed >>> 16) & 0xff) / 2)}, ${Math.floor(((packed >>> 8) & 0xff) / 2)}, ${Math.floor((packed & 0xff) / 2)})`;
  }
  if (resolved === "black") return nativeDefaultBackground;
  if (resolved === "white") return "rgb(127, 127, 127)";

  // Ghostty currently emits palette variables or rgb() for cell colors. Keep
  // a safe CSS fallback for a future valid color spelling without applying
  // opacity to the cell background.
  return `color-mix(in srgb, ${value} 50%, black)`;
}

// Ghostty records terminal cell widths, while browser font fallback can use
// proportional symbol/emoji advances. Keep Ghostty's narrow and common
// wcwidth=2 ranges on the terminal grid without altering visible text or the
// trusted style surface.
function isWideTerminalCodePoint(codePoint: number): boolean {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

function safeStyle(element: HTMLElement): React.CSSProperties {
  const result: Record<string, string | number> = {};
  let nativeDim = false;
  let nativeInverse = false;

  // Parse declarations ourselves because older DOM implementations discard
  // otherwise-valid CSS var() color values while reading CSSStyleDeclaration.
  // Property names and values are still accepted only by the exact checks
  // below; no declaration is copied wholesale.
  for (const declaration of (element.getAttribute("style") ?? "").split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();

    // Palette variables are supplied once on the scoped wrapper from Twee's
    // native palette. Formatter descendants may reference but not redefine
    // them, keeping native and browser colors deterministic.
    if (isPaletteProperty(property)) continue;

    switch (property) {
      case "color":
        if (safeColor(value)) result.color = value;
        break;
      case "background":
      case "background-color":
        if (safeColor(value)) result.backgroundColor = value;
        break;
      case "font-weight":
        if (/^(?:normal|bold|[1-9]00)$/.test(value)) result.fontWeight = value;
        break;
      case "font-style":
        if (/^(?:normal|italic|oblique)$/.test(value)) result.fontStyle = value;
        break;
      case "text-decoration-line":
        // Ghostty can combine safe decorations with CSS `blink`. Browsers do
        // not need to animate blink, but dropping the entire declaration would
        // also lose underline/overline/strikethrough fidelity.
        {
          const supported = value
            .toLowerCase()
            .split(/\s+/)
            .filter((token) => ["none", "underline", "overline", "line-through"].includes(token));
          if (supported.length) result.textDecorationLine = supported.join(" ");
        }
        break;
      case "text-decoration-color":
        if (safeColor(value)) result.textDecorationColor = value;
        break;
      case "text-decoration-style":
        if (/^(?:solid|double|dotted|dashed|wavy)$/.test(value)) result.textDecorationStyle = value;
        break;
      case "opacity": {
        const opacity = Number(value);
        if (opacity === 0.5) nativeDim = true;
        else if (Number.isFinite(opacity) && opacity >= 0 && opacity <= 1) result.opacity = opacity;
        break;
      }
      case "display":
        if (value.toLowerCase() === "inline") result.display = "inline";
        break;
      case "visibility":
        if (/^(?:hidden|visible)$/.test(value.toLowerCase())) result.visibility = value.toLowerCase();
        break;
      case "filter":
        if (/^invert\(100%\)$/.test(value.toLowerCase().split(" ").join(""))) {
          nativeInverse = true;
        }
        break;
    }
  }

  // Match Twee's native renderer rather than applying CSS effects to the
  // whole cell: inverse swaps foreground/background, then faint halves only
  // the resulting foreground channel values.
  if (nativeInverse) {
    const foreground = String(result.color ?? nativeDefaultForeground);
    const background = String(result.backgroundColor ?? nativeDefaultBackground);
    result.color = background;
    result.backgroundColor = foreground;
  }
  if (nativeDim) {
    result.color = dimNativeColor(String(result.color ?? nativeDefaultForeground));
  }

  return result as React.CSSProperties;
}

/**
 * Turn Ghostty's untrusted formatter HTML into a small React-only tree.
 * Links are deliberately unwrapped and attributes are rebuilt from scratch.
 */
export function sanitizeGhosttyHTML(html: string): React.ReactNode {
  if (typeof DOMParser === "undefined") return html;

  const document = new DOMParser().parseFromString(html, "text/html");
  let nextKey = 0;
  const paletteStyle: Record<string, string> = nativePalette;

  // Ghostty emits a <style> element with palette variables. The element is an
  // untrusted subtree and is discarded below; use Twee's native palette on
  // this scoped wrapper so formatter content cannot redefine its colors.

  const rebuildText = (text: string): React.ReactNode => {
    const clusters: string[] = [];
    let cluster = "";
    for (const character of text) {
      const codePoint = character.codePointAt(0)!;
      const extendsCluster = /\p{Mark}/u.test(character) ||
        (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
        codePoint === 0x200d ||
        cluster.endsWith("\u200d");
      if (cluster && !extendsCluster) {
        clusters.push(cluster);
        cluster = "";
      }
      cluster += character;
    }
    if (cluster) clusters.push(cluster);
    const cellWidth = (value: string): 1 | 2 | undefined => {
      if (isWideTerminalCodePoint(value.codePointAt(0)!)) return 2;
      // Non-ASCII and multi-codepoint cells can pick proportional/emoji
      // fallback advances in a browser. Ghostty still assigns one terminal
      // cell to narrow symbols, variation sequences, keycaps, and combining
      // graphemes, so constrain those clusters too.
      if (value.codePointAt(0)! >= 0x80 || Array.from(value).length > 1) return 1;
      return undefined;
    };
    if (!clusters.some((value) => cellWidth(value) != null)) return text;

    return clusters.map((value) => {
      const width = cellWidth(value);
      return width != null
        ? React.createElement("span", {
          key: nextKey += 1,
          "data-terminal-cell-width": width,
          style: { display: "inline-block", width: `${width}ch` },
        }, value)
        : value;
    });
  };

  const rebuild = (node: Node): React.ReactNode => {
    if (node.nodeType === Node.TEXT_NODE) return rebuildText(node.textContent ?? "");
    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();
    if (droppedSubtrees.has(tag)) return null;

    const children = Array.from(element.childNodes, rebuild);
    // OSC 8 links and unknown, non-active wrappers keep their visible text,
    // but never retain a navigable element or any of its attributes.
    if (tag === "a" || !allowedElements.has(tag)) {
      return React.createElement(React.Fragment, { key: nextKey += 1 }, ...children);
    }

    const style = safeStyle(element);
    if (tag === "pre") {
      Object.assign(style, {
        margin: 0,
        font: "inherit",
        lineHeight: "inherit",
        whiteSpace: "pre",
        overflowWrap: "normal",
      });
    }

    return React.createElement(
      tag,
      {
        key: nextKey += 1,
        ...(Object.keys(style).length ? { style } : {}),
      },
      ...children,
    );
  };

  return React.createElement(
    "div",
    {
      ...(Object.keys(paletteStyle).length
        ? { style: paletteStyle as React.CSSProperties }
        : {}),
    },
    ...Array.from(document.body.childNodes, rebuild),
  );
}

function formatSession(
  session: PlaybackSession,
  onHTML: (html: string) => void,
  onError: (error: Error) => void,
): void {
  if (session.animationFrame !== null || session.disposed) return;
  session.animationFrame = requestTerminalFrame(() => {
    session.animationFrame = null;
    if (session.disposed) return;
    try {
      onHTML(session.terminal.formatHTML());
    } catch (cause) {
      onError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  });
}

function applyThrough(
  session: PlaybackSession,
  targetTime: number,
  onHTML: (html: string) => void,
  onError: (error: Error) => void,
): void {
  if (session.disposed) return;
  const target = Math.max(0, Math.min(session.recording.timeline.duration, targetTime));
  let screenChanged = false;

  try {
    if (target < session.appliedTime) {
      session.terminal.reset(
        session.recording.manifest.cols,
        session.recording.manifest.rows,
      );
      session.nextEventIndex = 0;
      screenChanged = true;
    }

    const events = session.recording.terminalEvents;
    while (
      session.nextEventIndex < events.length &&
      events[session.nextEventIndex].time <= target
    ) {
      const event = events[session.nextEventIndex];
      // Advancing the index for every type preserves file order. Only VT
      // output and terminal resizing affect the Ghostty screen.
      session.nextEventIndex += 1;
      if (event.type === "output") {
        session.terminal.write(event.bytes);
        screenChanged = true;
      } else if (event.type === "resize") {
        session.terminal.resize(event.cols, event.rows);
        screenChanged = true;
      }
    }
    session.appliedTime = target;
    if (screenChanged) formatSession(session, onHTML, onError);
  } catch (cause) {
    onError(cause instanceof Error ? cause : new Error(String(cause)));
  }
}

export function TerminalPresentation({
  recording,
  currentTime,
  terminalFactory = defaultTerminalFactory,
  className,
  style,
}: TerminalPresentationProps) {
  const currentTimeRef = useRef(currentTime);
  const sessionRef = useRef<PlaybackSession | null>(null);
  const [html, setHTML] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<Error | null>(null);

  currentTimeRef.current = currentTime;

  useEffect(() => {
    let cancelled = false;
    setHTML("");
    setError(null);
    setStatus("loading");

    terminalFactory(recording.manifest.cols, recording.manifest.rows)
      .then((terminal) => {
        if (cancelled) {
          terminal.dispose();
          return;
        }
        const session: PlaybackSession = {
          terminal,
          recording,
          nextEventIndex: 0,
          appliedTime: 0,
          animationFrame: null,
          disposed: false,
        };
        sessionRef.current = session;
        setStatus("ready");
        applyThrough(session, currentTimeRef.current, setHTML, (nextError) => {
          setError(nextError);
          setStatus("error");
        });
        // An empty screen still needs one initial formatter pass.
        formatSession(session, setHTML, (nextError) => {
          setError(nextError);
          setStatus("error");
        });
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
        setStatus("error");
      });

    return () => {
      cancelled = true;
      const session = sessionRef.current;
      if (!session || session.recording !== recording) return;
      session.disposed = true;
      if (session.animationFrame !== null) cancelTerminalFrame(session.animationFrame);
      session.terminal.dispose();
      sessionRef.current = null;
    };
  }, [recording, terminalFactory]);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session || session.recording !== recording) return;
    applyThrough(session, currentTime, setHTML, (nextError) => {
      setError(nextError);
      setStatus("error");
    });
  }, [currentTime, recording]);

  const content = useMemo(() => sanitizeGhosttyHTML(html), [html]);

  return (
    <>
      <style data-record-player-terminal-fonts>{terminalFontFaces}</style>
      <div
        className={className}
        role="region"
        aria-label="Terminal playback"
        style={{
          boxSizing: "border-box",
          minHeight: 180,
          overflow: "auto",
          borderRadius: 8,
          background: "#000000",
          color: "#c8c8c8",
          padding: 12,
          fontFamily: terminalFont,
          fontSize: 14,
          // The packaged JetBrains face advances exactly 8px at this size in
          // Chromium; wide fallback glyphs are normalized to two cells by the
          // sanitizer above.
          lineHeight: "20px",
          whiteSpace: "pre",
          tabSize: 8,
          ...style,
        }}
      >
        {status === "loading" ? <div role="status">Loading terminal…</div> : null}
        {status === "error" ? (
          <div role="alert">Unable to render terminal: {error?.message ?? "Unknown error"}</div>
        ) : null}
        {status === "ready" ? content : null}
      </div>
    </>
  );
}
