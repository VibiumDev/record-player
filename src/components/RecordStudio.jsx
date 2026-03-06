import { useState, useRef, useEffect, useMemo, useCallback, forwardRef } from "react";

/*
  Vibium Player — player.vibium.dev
  
  Drop a Vibium record.zip onto this viewer.
  It uses JSZip to unzip, then parses the NDJSON event
  files and extracts screenshots from resources.
*/

// We'll load JSZip from CDN at runtime
let JSZipLoaded = null;
function loadJSZip() {
  if (JSZipLoaded) return JSZipLoaded;
  JSZipLoaded = new Promise((resolve, reject) => {
    if (window.JSZip) return resolve(window.JSZip);
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    s.onload = () => resolve(window.JSZip);
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return JSZipLoaded;
}

// ─── Parse trace NDJSON ─────────────────────────────────────────────────────
function parseNDJSON(text) {
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((line) => {
      try { return JSON.parse(line); }
      catch { return null; }
    })
    .filter(Boolean);
}

// ─── Extract data from parsed trace events ──────────────────────────────────
function processTraceEvents(events) {
  const actions = [];
  const consoleEvents = [];
  let contextOptions = null;
  const screenshotRefs = [];
  const actionMap = new Map();
  const groups = [];
  const groupCallIds = new Set();
  // Map snapshot name/id → metadata (viewport, scroll offsets)
  const snapshotMetaMap = new Map();
  const snapshotMetaList = [];

  const normalizeViewport = (v) => {
    if (!v) return null;
    if (Array.isArray(v) && v.length >= 2) {
      const width = Number(v[0]);
      const height = Number(v[1]);
      return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null;
    }
    const width = Number(v.width ?? v.w);
    const height = Number(v.height ?? v.h);
    return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null;
  };

  const setSnapshotAlias = (key, meta) => {
    if (key == null) return;
    const k = String(key);
    if (!k) return;
    snapshotMetaMap.set(k, meta);
  };

  for (const evt of events) {
    const type = evt.type;

    if (type === "context-options") {
      contextOptions = evt;
      continue;
    }

    // Parse frame-snapshot for viewport & scroll metadata
    if (type === "frame-snapshot") {
      const nestedSnapshot = evt.snapshot && typeof evt.snapshot === "object" ? evt.snapshot : null;
      const meta = {
        viewport:
          normalizeViewport(evt.viewport) ||
          normalizeViewport(evt.viewportSize) ||
          normalizeViewport(nestedSnapshot?.viewport) ||
          normalizeViewport(nestedSnapshot?.viewportSize) ||
          null,
        scrollX: Number(evt.scrollX ?? evt.scrollLeft ?? evt.scrollOffset?.x ?? nestedSnapshot?.scrollX ?? nestedSnapshot?.scrollLeft ?? 0) || 0,
        scrollY: Number(evt.scrollY ?? evt.scrollTop ?? evt.scrollOffset?.y ?? nestedSnapshot?.scrollY ?? nestedSnapshot?.scrollTop ?? 0) || 0,
        pageId: evt.pageId || evt.frameId || nestedSnapshot?.pageId || nestedSnapshot?.frameId || null,
        time: Number(evt.timestamp ?? evt.time ?? evt.startTime ?? 0) || 0,
      };

      // Register all likely snapshot id aliases
      const aliases = [
        typeof evt.snapshot === "string" ? evt.snapshot : null,
        evt.snapshotName,
        evt.snapshotId,
        evt.name,
        evt.title,
        evt.callId,
        nestedSnapshot?.snapshotName,
        nestedSnapshot?.name,
        nestedSnapshot?.id,
      ];
      for (const a of aliases) setSnapshotAlias(a, meta);

      snapshotMetaList.push(meta);
      continue;
    }

    const apiName = evt.title || (evt.class && evt.method ? `${evt.class}.${evt.method}` : "");

    // Groups: class=Tracing, method=group — before/after pairs
    if (type === "before" && evt.class === "Tracing" && evt.method === "group") {
      actionMap.set(evt.callId, {
        _isGroup: true,
        title: evt.title || evt.params?.name || "Group",
        startTime: evt.wallTime || evt.startTime,
      });
      groupCallIds.add(evt.callId);
      continue;
    }

    if (type === "after" && groupCallIds.has(evt.callId)) {
      const g = actionMap.get(evt.callId);
      if (g) {
        g.endTime = evt.endTime || g.startTime;
        groups.push({ title: g.title, startTime: g.startTime, endTime: g.endTime });
        actionMap.delete(evt.callId);
      }
      continue;
    }

    // Actions: before/after pairs
    if (type === "before") {
      actionMap.set(evt.callId, {
        callId: evt.callId,
        apiName,
        params: evt.params || {},
        startTime: evt.startTime,
        beforeSnapshot: evt.beforeSnapshot,
        pageId: evt.pageId,
      });
      continue;
    }

    if (type === "input") {
      const existing = actionMap.get(evt.callId);
      if (existing) {
        if (evt.point) existing.point = evt.point;
        if (evt.box) existing.box = evt.box;
      }
      continue;
    }

    if (type === "after") {
      const existing = actionMap.get(evt.callId);
      if (existing) {
        existing.endTime = evt.endTime || evt.startTime;
        existing.afterSnapshot = evt.afterSnapshot;
        existing.error = evt.error;
        existing.result = evt.result;
        actions.push(existing);
        actionMap.delete(evt.callId);
      }
      continue;
    }

    // Console: event with method=log.entryAdded
    if (type === "event" && evt.method === "log.entryAdded") {
      const args = evt.params?.args || [];
      consoleEvents.push({
        time: evt.time || evt.params?.timestamp,
        type: evt.params?.level || "log",
        text: args.map(a => a.value ?? JSON.stringify(a)).join(" ") || "",
      });
      continue;
    }

    // Screencast frames
    if (type === "screencast-frame") {
      screenshotRefs.push({
        time: evt.timestamp,
        sha1: evt.sha1,
        width: evt.width,
        height: evt.height,
      });
    }
  }

  // Collect orphaned before events (no matching after)
  for (const [, data] of actionMap) {
    if (data._isGroup) {
      groups.push({ title: data.title, startTime: data.startTime, endTime: data.startTime });
    } else {
      actions.push(data);
    }
  }

  // Attach snapshot metadata to actions
  for (const action of actions) {
    const snapCandidates = [action.beforeSnapshot, action.afterSnapshot].filter(Boolean).map(String);

    let meta = null;
    for (const snapName of snapCandidates) {
      if (snapshotMetaMap.has(snapName)) {
        meta = snapshotMetaMap.get(snapName);
        break;
      }
    }

    // Fallback: nearest frame-snapshot in time (prefer same page when available)
    if (!meta && snapshotMetaList.length) {
      const targetTime = Number(action.startTime ?? action.endTime ?? 0) || 0;
      let best = null;
      let bestDist = Infinity;
      for (const cand of snapshotMetaList) {
        if (action.pageId && cand.pageId && action.pageId !== cand.pageId) continue;
        const dist = Math.abs((cand.time || 0) - targetTime);
        if (dist < bestDist) {
          bestDist = dist;
          best = cand;
        }
      }
      meta = best;
    }

    if (meta) action._snapshotMeta = meta;
  }

  actions.sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
  consoleEvents.sort((a, b) => (a.time || 0) - (b.time || 0));
  screenshotRefs.sort((a, b) => (a.time || 0) - (b.time || 0));

  // Derive fallback viewport from first screencast-frame dimensions
  let fallbackViewport = null;
  if (screenshotRefs.length > 0) {
    const first = screenshotRefs[0];
    if (first.width && first.height) {
      fallbackViewport = { width: first.width, height: first.height };
    }
  }

  return { actions, consoleEvents, contextOptions, screenshotRefs, groups, snapshotMetaMap, fallbackViewport };
}

// ─── Parse network events (BiDi format) ─────────────────────────────────────
function processNetworkEvents(events) {
  const pending = new Map(); // requestId -> partial data
  const results = [];

  for (const evt of events) {
    // HAR-style format (Vibium traces): { snapshot: { request, response, _monotonicTime, ... } }
    if (evt.snapshot) {
      const snap = evt.snapshot;
      const req = snap.request || {};
      const resp = snap.response || {};
      results.push({
        url: req.url || "",
        method: req.method || "GET",
        startTime: (snap._monotonicTime || 0) * 1000, // seconds → ms
        endTime: (snap._monotonicTime || 0) * 1000 + (snap.time || 0),
        status: resp.status || 0,
        statusText: resp.statusText || "",
        mimeType: resp.content?.mimeType || "",
        size: resp.content?.size || 0,
      });
      continue;
    }

    // BiDi format: { method: "network.beforeRequestSent" / "network.responseCompleted", params: { ... } }
    const method = evt.method;
    const params = evt.params || {};
    const req = params.request || {};
    const requestId = req.request;

    if (method === "network.beforeRequestSent") {
      pending.set(requestId, {
        url: req.url || "",
        method: req.method || "GET",
        startTime: params.timestamp || evt.timestamp || 0,
        resourceType: req["goog:resourceType"] || req.destination || "",
      });
    }

    if (method === "network.responseCompleted") {
      const resp = params.response || {};
      const entry = pending.get(requestId) || {
        url: req.url || "",
        method: req.method || "GET",
        startTime: params.timestamp || evt.timestamp || 0,
      };
      entry.endTime = params.timestamp || evt.timestamp || 0;
      entry.status = resp.status || 0;
      entry.statusText = resp.statusText || "";
      entry.mimeType = resp.mimeType || "";
      results.push(entry);
      pending.delete(requestId);
    }
  }

  // Include pending requests that never completed
  for (const [, entry] of pending) {
    entry.endTime = entry.startTime;
    entry.status = 0;
    results.push(entry);
  }

  results.sort((a, b) => a.startTime - b.startTime);
  return results;
}

// ─── Format time helper ─────────────────────────────────────────────────────
function fmt(ms) {
  if (!ms && ms !== 0) return "--";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  const frac = Math.floor((ms % 1000) / 10);
  return `${m}:${String(sec).padStart(2, "0")}.${String(frac).padStart(2, "0")}`;
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url?.slice(0, 60) || "";
  }
}

// ─── Vibium brand palette ────────────────────────────────────────────────────
const VIBIUM_LOGO = "data:image/png;base64,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";
const VIBIUM_LOGO_HI = "data:image/png;base64,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";

const brand = {
  orange:     "#f97316",  // safety orange — primary
  amber:      "#fb923c",  // warm amber
  sunset:     "#f59e0b",  // sunset gold
  blue:       "#3b82f6",  // bright blue — interactions
  magenta:    "#d946ef",  // electric magenta
  purple:     "#a855f7",  // deep purple
  grape:      "#7c3aed",  // grape
};

const darkSurface = {
  bg:         "#0c0a09",
  bgCard:     "#1c1917",
  bgPanel:    "#171412",
  border:     "#292524",
  borderLit:  "#44403c",
  textDim:    "#78716c",
  textMid:    "#a8a29e",
  text:       "#e7e5e4",
  textAction: "#d6d3d1",
  overlayBg:  "#1c1917dd",
};

const lightSurface = {
  bg:         "#fafaf9",
  bgCard:     "#f5f5f4",
  bgPanel:    "#e7e5e4",
  border:     "#c8c4bf",
  borderLit:  "#8c857e",
  textDim:    "#78716c",
  textMid:    "#44403c",
  text:       "#1c1917",
  textAction: "#1c1917",
  overlayBg:  "#f5f5f4ee",
};

// ─── Color helpers ──────────────────────────────────────────────────────────
function actionColor(apiName) {
  const n = (apiName || "").toLowerCase();
  if (n.includes("goto") || n.includes("navigate")) return brand.orange;
  if (n.includes("click") || n.includes("tap") || n.includes("dblclick")) return brand.blue;
  if (n.includes("fill") || n.includes("type") || n.includes("press")) return brand.amber;
  if (n.includes("wait") || n.includes("expect")) return brand.purple;
  if (n.includes("screenshot")) return brand.sunset;
  if (n.includes("check") || n.includes("assert")) return "#22c55e";
  if (n.includes("find") || n.includes("locator") || n.includes("getby")) return brand.grape;
  if (n.includes("text")) return brand.magenta;
  return brand.orange;
}

function statusColor(s) {
  if (s >= 400) return "#ef4444";
  if (s >= 300) return brand.sunset;
  return "#22c55e";
}

function isSensitiveField(selector) {
  const s = (selector || "").toLowerCase();
  return /passw|secret|token|api.?key|auth|credential|ssn|social.?sec|credit.?card|card.?num|cvv|cvc|pin\b|otp\b/.test(s);
}

function humanizeAction(action, mask = true) {
  const n = (action.apiName || "").toLowerCase();
  const p = action.params || {};
  const sel = p.selector || "";
  const short = sel.length > 28 ? sel.slice(0, 26) + "…" : sel;

  if (n.includes("navigate") || n.includes("goto")) {
    try { return "Navigate to " + new URL(p.url).hostname; } catch { return "Navigate to " + (p.url || "page"); }
  }
  if (n.includes("fill") || n.includes("type")) {
    const sensitive = mask && isSensitiveField(sel);
    const v = p.value || "";
    const vt = sensitive ? "••••••" : (v.length > 20 ? v.slice(0, 18) + "…" : v);
    return `Type "${vt}" into ${short || "field"}`;
  }
  if (n.includes("dblclick")) return "Double-click " + (short || "element");
  if (n.includes("click")) return "Click " + (short || "element");
  if (n.includes("press")) return "Press " + (p.key || p.value || "key");
  if (n.includes("check") && !n.includes("uncheck")) return "Check " + (short || "checkbox");
  if (n.includes("uncheck")) return "Uncheck " + (short || "checkbox");
  if (n.includes("select")) return "Select " + (p.value || p.label || "option");
  if (n.includes("hover")) return "Hover " + (short || "element");
  if (n.includes("scroll")) return "Scroll";
  if (n.includes("wait")) return "Wait" + (p.ms ? " " + p.ms + "ms" : "");
  if (n.includes("text")) return "Text from " + (short || "element");
  if (n.includes("find") || n.includes("locator")) return "Find " + (short || "element");
  if (n.includes("screenshot")) return "Screenshot";
  if (n.includes("expect") || n.includes("assert")) return "Assert " + (short || "");
  if (n.includes("focus")) return "Focus " + (short || "element");
  if (n.includes("drag")) return "Drag " + (short || "element");
  return action.apiName || "Action";
}

function isHumanAction(apiName) {
  const n = (apiName || "").toLowerCase();
  return n.includes("goto") || n.includes("navigate") || n.includes("click") || n.includes("tap") ||
    n.includes("fill") || n.includes("type") || n.includes("press") || n.includes("check") ||
    n.includes("uncheck") || n.includes("select") || n.includes("hover") || n.includes("dblclick") ||
    n.includes("drag") || n.includes("scroll") || n.includes("setinputfiles") || n.includes("focus") ||
    n.includes("wait");
}

// ─── Main component ─────────────────────────────────────────────────────────
function getPanelDefault(key, fallback) {
  try {
    const v = localStorage.getItem(`record-panel-${key}`);
    if (v === "true") return true;
    if (v === "false") return false;
    return fallback;
  } catch { return fallback; }
}

function parseUrlParams() {
  try {
    const p = new URLSearchParams(window.location.search);
    const val = (long, short) => (p.get(long) || p.get(short) || "").toLowerCase();
    const timeline = val("timeline", "t");
    const inspector = val("inspector", "i");
    const atRaw = p.get("at") || null;
    // Parse "at" — supports ms (e.g. "5000"), seconds with s suffix (e.g. "5s"),
    // or m:ss.ff format (e.g. "1:23.45")
    let atMs = null;
    if (atRaw) {
      const mMatch = atRaw.match(/^(\d+):(\d{1,2})(?:\.(\d{1,2}))?$/);
      if (mMatch) {
        atMs = (parseInt(mMatch[1]) * 60 + parseInt(mMatch[2])) * 1000 + (mMatch[3] ? parseInt(mMatch[3].padEnd(2, "0")) * 10 : 0);
      } else if (atRaw.endsWith("s")) {
        atMs = parseFloat(atRaw) * 1000;
      } else {
        atMs = parseFloat(atRaw);
      }
      if (isNaN(atMs)) atMs = null;
    }
    const controls = val("controls", "c");
    return {
      timeline: timeline === "visible" || timeline === "v" ? true : timeline === "hidden" || timeline === "h" ? false : null,
      inspector: inspector === "visible" || inspector === "v" ? true : inspector === "hidden" || inspector === "h" ? false : null,
      controls: controls === "visible" || controls === "v" ? true : controls === "hidden" || controls === "h" ? false : null,
      at: atMs,
    };
  } catch { return { timeline: null, inspector: null, controls: null, at: null }; }
}

// ─── Action Overlay (cursor, highlight, ripple, caret) ──────────────────────
const CURSOR_SVG = (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" style={{ filter: "drop-shadow(1px 2px 3px rgba(0,0,0,0.5))" }}>
    <path d="M5 3l14 8-6.5 1.5L11 19z" fill="#fff" stroke="#000" strokeWidth="1.5" strokeLinejoin="round"/>
  </svg>
);

// ─── Coordinate normalization helper ────────────────────────────────────────
// Tries multiple coordinate bases + boost factors and picks the lowest-penalty fit.
function normalizeActionCoords({ action, screenshot, viewport, dpr, imgW, imgH, natW, natH }) {
  if (!action?.point) return null;

  const numericDpr = Number(dpr);
  const scaleFactor = Number.isFinite(numericDpr) && numericDpr > 0 ? numericDpr : 1;
  const scrollX = action._snapshotMeta?.scrollX || 0;
  const scrollY = action._snapshotMeta?.scrollY || 0;
  const snapshotViewport = action._snapshotMeta?.viewport;
  const targetViewport = snapshotViewport || viewport || null;
  const pt = action.point;
  const box = action.box;

  const addCandidate = (list, coordW, coordH, offsetX, offsetY, source, ratioMode = false, boosts = [1]) => {
    if (!coordW || !coordH || !Number.isFinite(coordW) || !Number.isFinite(coordH)) return;
    for (const boost of boosts) {
      if (!Number.isFinite(boost) || boost <= 0) continue;
      list.push({ coordW, coordH, offsetX, offsetY, source, ratioMode, boost });
    }
  };

  const candidates = [];

  if (snapshotViewport?.width && snapshotViewport?.height) {
    addCandidate(candidates, snapshotViewport.width, snapshotViewport.height, 0, 0, "snapshot-viewport");
    if (scrollX || scrollY) {
      addCandidate(candidates, snapshotViewport.width, snapshotViewport.height, scrollX, scrollY, "snapshot-viewport-scroll-sub");
      addCandidate(candidates, snapshotViewport.width, snapshotViewport.height, -scrollX, -scrollY, "snapshot-viewport-scroll-add");
    }
    addCandidate(candidates, snapshotViewport.width, snapshotViewport.height, 0, 0, "snapshot-viewport-ratio", true);
  }

  if (viewport?.width && viewport?.height) {
    addCandidate(candidates, viewport.width, viewport.height, 0, 0, "context-viewport");
    if (scrollX || scrollY) {
      addCandidate(candidates, viewport.width, viewport.height, scrollX, scrollY, "context-viewport-scroll-sub");
      addCandidate(candidates, viewport.width, viewport.height, -scrollX, -scrollY, "context-viewport-scroll-add");
    }
    addCandidate(candidates, viewport.width, viewport.height, 0, 0, "context-viewport-ratio", true);
  }

  // Use per-screenshot dimensions as viewport candidate when no snapshot viewport exists
  if (!snapshotViewport && screenshot?.width && screenshot?.height) {
    addCandidate(candidates, screenshot.width, screenshot.height, 0, 0, "screencast-frame-viewport");
    if (scrollX || scrollY) {
      addCandidate(candidates, screenshot.width, screenshot.height, scrollX, scrollY, "screencast-frame-viewport-scroll-sub");
      addCandidate(candidates, screenshot.width, screenshot.height, -scrollX, -scrollY, "screencast-frame-viewport-scroll-add");
    }
    addCandidate(candidates, screenshot.width, screenshot.height, 0, 0, "screencast-frame-viewport-ratio", true);
  }

  // Boost factors help when trace coords are in CSS pixels but screenshot metadata is in device pixels.
  const inferredBoosts = Array.from(new Set([
    1,
    2,
    3,
    ...(targetViewport?.width && screenshot?.width ? [Math.round(screenshot.width / targetViewport.width)] : []),
    ...(targetViewport?.width && natW ? [Math.round(natW / targetViewport.width)] : []),
    ...(targetViewport?.height && screenshot?.height ? [Math.round(screenshot.height / targetViewport.height)] : []),
    ...(targetViewport?.height && natH ? [Math.round(natH / targetViewport.height)] : []),
  ].filter((b) => Number.isFinite(b) && b >= 1 && b <= 4)));
  const rawBoosts = inferredBoosts;

  if (screenshot?.width && screenshot?.height) {
    addCandidate(candidates, screenshot.width / scaleFactor, screenshot.height / scaleFactor, 0, 0, "screenshot/dpr");
    addCandidate(candidates, screenshot.width, screenshot.height, 0, 0, "screenshot-raw", false, rawBoosts);
    addCandidate(candidates, screenshot.width, screenshot.height, 0, 0, "screenshot-ratio", true);
  }

  if (natW && natH) {
    addCandidate(candidates, natW / scaleFactor, natH / scaleFactor, 0, 0, "natural/dpr");
    addCandidate(candidates, natW, natH, 0, 0, "natural-raw", false, rawBoosts);
    addCandidate(candidates, natW, natH, 0, 0, "natural-ratio", true);
  }

  if (candidates.length === 0) return null;

  const tolerance = 0.12;
  const minX = -imgW * tolerance;
  const maxX = imgW * (1 + tolerance);
  const minY = -imgH * tolerance;
  const maxY = imgH * (1 + tolerance);

  let best = null;
  let bestPenalty = Infinity;

  for (const c of candidates) {
    const scaleX = (imgW / c.coordW) * c.boost;
    const scaleY = (imgH / c.coordH) * c.boost;

    const rawX = c.ratioMode ? pt.x * c.coordW : (pt.x - c.offsetX);
    const rawY = c.ratioMode ? pt.y * c.coordH : (pt.y - c.offsetY);

    const normPx = rawX * scaleX;
    const normPy = rawY * scaleY;

    let penalty = 0;
    if (normPx < minX) penalty += (minX - normPx);
    if (normPx > maxX) penalty += (normPx - maxX);
    if (normPy < minY) penalty += (minY - normPy);
    if (normPy > maxY) penalty += (normPy - maxY);

    // Discourage ratio mode unless incoming coordinates look ratio-like.
    const looksRatioPoint = pt.x >= 0 && pt.x <= 1.05 && pt.y >= 0 && pt.y <= 1.05;
    if (c.ratioMode && !looksRatioPoint) penalty += 10000;
    if (!c.ratioMode && looksRatioPoint) penalty += 2000;

    // Prefer candidates whose effective coordinate basis matches known viewport.
    if (targetViewport?.width && targetViewport?.height && !c.ratioMode) {
      const effW = c.coordW / c.boost;
      const effH = c.coordH / c.boost;
      penalty += Math.abs(effW - targetViewport.width) * 0.03;
      penalty += Math.abs(effH - targetViewport.height) * 0.03;

      const inferredMaxBoost = Math.max(...inferredBoosts);
      if (inferredMaxBoost >= 2 && c.boost === 1) penalty += 120;
      if (c.boost > 1 && inferredBoosts.includes(c.boost)) penalty -= 120;
    }

    let bx, by, bw, bh;
    if (box) {
      const rawBx = c.ratioMode ? box.x * c.coordW : (box.x - c.offsetX);
      const rawBy = c.ratioMode ? box.y * c.coordH : (box.y - c.offsetY);
      const rawBw = c.ratioMode ? box.width * c.coordW : box.width;
      const rawBh = c.ratioMode ? box.height * c.coordH : box.height;

      bx = rawBx * scaleX;
      by = rawBy * scaleY;
      bw = rawBw * scaleX;
      bh = rawBh * scaleY;

      if (bw <= 1 || bh <= 1) penalty += 10000;
      if (bw < 8 || bh < 8) penalty += 250;
      if (bw > imgW * 1.4 || bh > imgH * 1.4) penalty += 6000;

      const boxOverflowX = Math.max(0, minX - bx) + Math.max(0, bx + bw - maxX);
      const boxOverflowY = Math.max(0, minY - by) + Math.max(0, by + bh - maxY);
      penalty += (boxOverflowX + boxOverflowY) * 0.7;

      // Check point-in-box. Also try with scroll-adjusted box (box in page-space, point in viewport-space).
      const pointInBox = normPx >= bx - 2 && normPx <= bx + bw + 2 && normPy >= by - 2 && normPy <= by + bh + 2;
      if (!pointInBox) {
        // Try adjusting box by scroll offset in case box is page-relative but point is viewport-relative
        if ((scrollX || scrollY) && !c.ratioMode) {
          const adjBx = (box.x - scrollX) * scaleX;
          const adjBy = (box.y - scrollY) * scaleY;
          const adjBw = box.width * scaleX;
          const adjBh = box.height * scaleY;
          const pointInAdjBox = normPx >= adjBx - 2 && normPx <= adjBx + adjBw + 2 && normPy >= adjBy - 2 && normPy <= adjBy + adjBh + 2;
          if (pointInAdjBox && c.offsetX === 0 && c.offsetY === 0) {
            // Point fits in scroll-adjusted box with zero point offset — use adjusted box for rendering
            bx = adjBx; by = adjBy; bw = adjBw; bh = adjBh;
            // Mild penalty since box needed adjustment
            penalty += 200;
          } else {
            penalty += 3000;
          }
        } else {
          penalty += 3000;
        }
      }
    }

    // If coords already look viewport-based, strongly prefer zero-scroll offsets.
    const looksViewport = pt.x >= -1 && pt.y >= -1 && pt.x <= (c.coordW / c.boost) + 1 && pt.y <= (c.coordH / c.boost) + 1;
    if ((scrollX || scrollY) && looksViewport && !c.ratioMode) {
      if (c.offsetX === 0 && c.offsetY === 0) penalty -= 60;
      else penalty += 120;
    }

    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      best = { scaleX, scaleY, px: normPx, py: normPy, source: c.source, boost: c.boost, coordW: c.coordW / c.boost, coordH: c.coordH / c.boost, bx, by, bw, bh };
    }
  }

  if (!best || bestPenalty > Math.max(imgW, imgH) * 1.2) return null;
  return best;
}

// Persistent cursor component — always visible, animates between positions
const PersistentCursor = ({ action, screenshot, viewport, dpr, imgEl, containerEl, layoutKey }) => {
  const [pos, setPos] = useState({ x: 0, y: 0, visible: false });

  useEffect(() => {
    const recalc = () => {
      if (!imgEl || !containerEl) return;
      if (!action || !action.point) return;
      const natW = imgEl.naturalWidth || 1;
      const natH = imgEl.naturalHeight || 1;
      const cRect = containerEl.getBoundingClientRect();
      const iRect = imgEl.getBoundingClientRect();
      if (!iRect.width || !iRect.height) return;
      const imgLeft = iRect.left - cRect.left;
      const imgTop = iRect.top - cRect.top;
      const imgW = iRect.width;
      const imgH = iRect.height;
      const norm = normalizeActionCoords({ action, screenshot, viewport, dpr, imgW, imgH, natW, natH });
      if (!norm) return;
      setPos({ x: imgLeft + norm.px, y: imgTop + norm.py, visible: true });
    };
    recalc();
    // Recalculate after panel transition settles
    const t = setTimeout(recalc, 250);
    return () => clearTimeout(t);
  }, [action?.callId, action?.point?.x, action?.point?.y, screenshot, viewport, dpr, imgEl, containerEl, layoutKey]);

  if (!pos.visible) return null;
  return (
    <div style={{
      position: "absolute",
      left: pos.x,
      top: pos.y,
      transition: "left 0.35s cubic-bezier(0.4, 0, 0.2, 1), top 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
      zIndex: 6,
      pointerEvents: "none",
    }}>
      {CURSOR_SVG}
    </div>
  );
};

const ActionOverlay = forwardRef(function ActionOverlay({ action, screenshot, viewport, dpr, imgEl, containerEl, showDebug, layoutKey }, _ref) {
  const [, forceUpdate] = useState(0);
  useEffect(() => { const t = setTimeout(() => forceUpdate(n => n + 1), 250); return () => clearTimeout(t); }, [layoutKey]);
  if (!action || !action.point || !imgEl || !containerEl) return null;

  const natW = imgEl.naturalWidth || 1;
  const natH = imgEl.naturalHeight || 1;

  const cRect = containerEl.getBoundingClientRect();
  const iRect = imgEl.getBoundingClientRect();
  if (!iRect.width || !iRect.height) return null;

  const imgLeft = iRect.left - cRect.left;
  const imgTop = iRect.top - cRect.top;
  const imgW = iRect.width;
  const imgH = iRect.height;

  const norm = normalizeActionCoords({ action, screenshot, viewport, dpr, imgW, imgH, natW, natH });
  if (!norm) return null;

  const px = imgLeft + norm.px;
  const py = imgTop + norm.py;
  const color = actionColor(action.apiName);
  const n = (action.apiName || "").toLowerCase();
  const isClick = n.includes("click") || n.includes("tap") || n.includes("dblclick");
  const isType = n.includes("fill") || n.includes("type") || n.includes("press");

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 5, overflow: "hidden" }}>
      <style>{`
        @keyframes ov-ripple { 0% { transform: translate(-50%,-50%) scale(0); opacity: 0.6; } 100% { transform: translate(-50%,-50%) scale(1); opacity: 0; } }
        @keyframes ov-blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
      `}</style>
      {/* Highlight box */}
      {norm.bx != null && (
        <div style={{
          position: "absolute",
          left: imgLeft + norm.bx,
          top: imgTop + norm.by,
          width: norm.bw,
          height: norm.bh,
          border: `3px solid ${color}`,
          background: `${color}20`,
          borderRadius: 3,
          transition: "left 0.3s cubic-bezier(0.4,0,0.2,1), top 0.3s cubic-bezier(0.4,0,0.2,1), width 0.3s cubic-bezier(0.4,0,0.2,1), height 0.3s cubic-bezier(0.4,0,0.2,1)",
        }} />
      )}
      {/* Click ripple */}
      {isClick && (
        <div key={action.callId} style={{
          position: "absolute", left: px, top: py,
          width: 40, height: 40, borderRadius: "50%",
          border: `2px solid ${color}`,
          animation: "ov-ripple 0.4s ease-out forwards",
        }} />
      )}
      {/* Type caret */}
      {isType && (
        <div style={{
          position: "absolute", left: px + 2, top: py - 8,
          width: 2, height: 18, background: color,
          animation: "ov-blink 0.8s step-end infinite",
        }} />
      )}
      {/* Debug badge */}
      {showDebug && (
        <div style={{
          position: "absolute", bottom: 4, left: 4, background: "rgba(0,0,0,0.8)", color: "#0f0",
          fontSize: 10, fontFamily: "monospace", padding: "2px 6px", borderRadius: 3, zIndex: 10,
          lineHeight: 1.4, whiteSpace: "pre",
        }}>
          {`src: ${norm.source} (x${norm.boost.toFixed(2)})\ncoord: ${norm.coordW.toFixed(0)}×${norm.coordH.toFixed(0)}\nimg: ${imgW.toFixed(0)}×${imgH.toFixed(0)}\npt: ${action.point.x.toFixed(3)},${action.point.y.toFixed(3)}\nscale: ${norm.scaleX.toFixed(3)},${norm.scaleY.toFixed(3)}`}
        </div>
      )}
    </div>
  );
});

const RecordStudio = forwardRef(function RecordStudio(_props, _ref) {
  const urlParams = useMemo(parseUrlParams, []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [traceData, setTraceData] = useState(null);
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activePanel, setActivePanel] = useState("actions");
  const [zoom, setZoom] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(false);
  const [selectedAction, setSelectedAction] = useState(null);
  const [actionFilter, setActionFilter] = useState("human");
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
  const [hoveredThumb, setHoveredThumb] = useState(null);
  const [fileList, setFileList] = useState([]);
  const [dark, setDark] = useState(true);
  const [overlayEnabled, setOverlayEnabled] = useState(true);
  const [sideW, setSideW] = useState(360);
  const [showSide, setShowSide] = useState(urlParams.inspector ?? getPanelDefault("inspector", false));
  const [timelineH, setTimelineH] = useState(212);
  const [showTimeline, setShowTimeline] = useState(urlParams.timeline ?? getPanelDefault("timeline", false));
  const [showToolbar, setShowToolbar] = useState(urlParams.controls ?? getPanelDefault("controls", true));
  const [detailH, setDetailH] = useState(160);
  const [showHelp, setShowHelp] = useState(false);
  const helpRef = useRef(false);
  const [maskSensitive, setMaskSensitive] = useState(true);
  const [showDetail, setShowDetail] = useState(false);
  const [layoutMode, setLayoutMode] = useState(getPanelDefault("layout", "main"));
  const [screenshotH, setScreenshotH] = useState(null); // null = 50% default
  const playRef = useRef(null);
  const scrollRef = useRef(null);
  const filmstripRef = useRef(null);
  const footerRef = useRef(null);
  const [footerNarrow, setFooterNarrow] = useState(false);

  // Detect if footer has room for stats
  useEffect(() => {
    const el = footerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setFooterNarrow(entry.contentRect.width < 1000);
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  // ─── Mobile detection ─────────────────────────────────────────────────
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const [compact, setCompact] = useState(() => typeof window !== "undefined" && window.innerHeight < 500);
  const [logoSpinning, setLogoSpinning] = useState(false);
  useEffect(() => {
    const mqW = window.matchMedia("(max-width: 767px)");
    const mqH = window.matchMedia("(max-height: 499px)");
    const onW = (e) => setMobile(e.matches);
    const onH = (e) => setCompact(e.matches);
    mqW.addEventListener("change", onW);
    mqH.addEventListener("change", onH);
    return () => { mqW.removeEventListener("change", onW); mqH.removeEventListener("change", onH); };
  }, []);
  const touchRef = useRef({ startX: 0, startY: 0 });
  const prevPointRef = useRef(null);
  const imgRef = useRef(null);
  const screenshotContainerRef = useRef(null);
  const [imgDims, setImgDims] = useState({ w: 0, h: 0 });

  // On mobile/compact, collapse panels (but keep inspector visible in stacked mode)
  useEffect(() => {
    if (mobile || compact) { setShowTimeline(false); setShowDetail(false); if (layoutMode !== "stacked") setShowSide(false); }
  }, [mobile, compact, layoutMode]);

  // Auto-switch to stacked layout on narrow/portrait screens
  useEffect(() => {
    if (mobile) setLayoutMode("stacked");
  }, [mobile]);

  useEffect(() => {
    const check = () => {
      const portrait = window.innerHeight > window.innerWidth;
      const narrow = window.innerWidth < 900;
      if (portrait && narrow) setLayoutMode("stacked");
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Merge brand + surface colors for current theme
  const V = useMemo(() => ({ ...brand, ...(dark ? darkSurface : lightSurface) }), [dark]);
  const levelColors = useMemo(() => ({ log: V.textMid, info: brand.amber, warn: brand.sunset, error: "#f87171", warning: brand.sunset }), [V]);
  const dragging = useRef(false);
  const sideDrag = useRef(false);
  const timelineDrag = useRef(false);
  const detailDrag = useRef(false);
  const detailDragStart = useRef({ y: 0, h: 0 });
  const stackedDrag = useRef(false);
  const stackedDragStart = useRef({ y: 0, h: 0 });
  const mainAreaRef = useRef(null);

  // ─── Panel resize handlers ──────────────────────────────────────────────
  useEffect(() => {
    const getXY = (e) => {
      if (e.touches && e.touches.length) return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
      return { clientX: e.clientX, clientY: e.clientY };
    };
    const onMove = (e) => {
      const { clientX, clientY } = getXY(e);
      if (sideDrag.current) {
        const newW = window.innerWidth - clientX;
        setSideW(Math.max(180, Math.min(600, newW)));
      }
      if (timelineDrag.current) {
        const statusBarH = 24;
        const newH = window.innerHeight - clientY - statusBarH;
        setTimelineH(Math.max(60, Math.min(300, newH)));
      }
      if (detailDrag.current) {
        const delta = detailDragStart.current.y - clientY;
        setDetailH(Math.max(60, Math.min(500, detailDragStart.current.h + delta)));
      }
      if (stackedDrag.current) {
        const delta = clientY - stackedDragStart.current.y;
        setScreenshotH(Math.max(100, Math.min(800, stackedDragStart.current.h + delta)));
      }
      if (dragging.current && scrollRef.current) {
        const el = scrollRef.current;
        const rect = el.getBoundingClientRect();
        const edgeZone = 60;
        const maxSpeed = 4;
        const cursorX = clientX - rect.left;
        if (cursorX < edgeZone) {
          const t = 1 - cursorX / edgeZone;
          el.scrollLeft = Math.max(0, el.scrollLeft - maxSpeed * t);
        } else if (cursorX > rect.width - edgeZone) {
          const t = 1 - (rect.width - cursorX) / edgeZone;
          el.scrollLeft = Math.min(el.scrollWidth - rect.width, el.scrollLeft + maxSpeed * t);
        }
        const x = clientX - rect.left + el.scrollLeft - 56;
        const tw = el.scrollWidth - 56;
        const dur = traceData?.duration || 1;
        setPlayhead(Math.max(0, Math.min(dur, (x / tw) * dur)));
      }
      // Prevent scrolling while dragging dividers on touch
      if ((sideDrag.current || timelineDrag.current || detailDrag.current || stackedDrag.current || dragging.current) && e.cancelable) {
        e.preventDefault();
      }
    };
    const onUp = () => {
      sideDrag.current = false;
      timelineDrag.current = false;
      detailDrag.current = false;
      stackedDrag.current = false;
      dragging.current = false;
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
    window.addEventListener("touchcancel", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
      window.removeEventListener("touchcancel", onUp);
    };
  }, [traceData]);

  // ─── Load trace.zip ─────────────────────────────────────────────────────
  const loadTrace = useCallback(async (file) => {
    setLoading(true);
    setError(null);
    try {
      const JSZip = await loadJSZip();
      const zip = await JSZip.loadAsync(file);
      const files = Object.keys(zip.files);
      setFileList(files);

      // Parse *.trace files (NDJSON)
      let allEvents = [];
      for (const fname of files) {
        if (fname.endsWith(".trace") && !zip.files[fname].dir) {
          try {
            const text = await zip.files[fname].async("string");
            if (text.trim()) allEvents.push(...parseNDJSON(text));
          } catch {}
        }
      }

      // Parse *.network files (NDJSON, may be empty)
      let networkEvents = [];
      for (const fname of files) {
        if (fname.endsWith(".network") && !zip.files[fname].dir) {
          try {
            const text = await zip.files[fname].async("string");
            if (text.trim()) networkEvents.push(...parseNDJSON(text));
          } catch {}
        }
      }

      // Load resources/ as data URIs (sha1 hashes, no file extension)
      const screenshots = new Map();
      for (const fname of files) {
        if (fname.startsWith("resources/") && !zip.files[fname].dir) {
          try {
            const base64 = await zip.files[fname].async("base64");
            const sha1 = fname.split("/").pop();
            screenshots.set(sha1, `data:image/png;base64,${base64}`);
          } catch {}
        }
      }

      const { actions, consoleEvents, contextOptions, screenshotRefs, groups } = processTraceEvents(allEvents);
      const network = processNetworkEvents(networkEvents);

      // Resolve screenshot refs to data URIs
      const resolvedScreenshots = screenshotRefs
        .map((ref) => ({ ...ref, url: screenshots.get(ref.sha1) || null }))
        .filter((s) => s.url);

      // Calculate timeline bounds
      const allTimes = [
        ...actions.flatMap((a) => [a.startTime, a.endTime].filter(Boolean)),
        ...network.flatMap((n) => [n.startTime, n.endTime].filter(Boolean)),
        ...consoleEvents.map((c) => c.time).filter(Boolean),
        ...screenshotRefs.map((s) => s.time).filter(Boolean),
        ...groups.flatMap((g) => [g.startTime, g.endTime].filter(Boolean)),
      ];

      const minTime = Math.min(...allTimes) || 0;
      const maxTime = Math.max(...allTimes) || 1;
      const duration = maxTime - minTime;
      const normalize = (t) => (t || 0) - minTime;

      setTraceData({
        actions: actions.map((a) => ({
          ...a,
          startTime: normalize(a.startTime),
          endTime: normalize(a.endTime || a.startTime),
          duration: (a.endTime || a.startTime || 0) - (a.startTime || 0),
        })),
        network: network.map((n) => ({
          ...n,
          startTime: normalize(n.startTime),
          endTime: normalize(n.endTime || n.startTime),
          duration: (n.endTime || n.startTime || 0) - (n.startTime || 0),
        })),
        console: consoleEvents.map((c) => ({ ...c, time: normalize(c.time) })),
        screenshots: resolvedScreenshots.map((s) => ({ ...s, time: normalize(s.time) })).sort((a, b) => a.time - b.time),
        groups: groups.map((g) => ({
          ...g,
          startTime: normalize(g.startTime),
          endTime: normalize(g.endTime || g.startTime),
        })).sort((a, b) => a.startTime - b.startTime),
        contextOptions,
        duration,
        fileCount: files.length,
        eventCount: allEvents.length,
      });

      setPlayhead(urlParams.at != null ? Math.max(0, Math.min(urlParams.at, duration)) : 0);

      // First-time visitors: open all panels after trace loads
      const hasStoredPrefs = ["inspector","timeline","controls"].some(k => localStorage.getItem(`record-panel-${k}`) !== null);
      if (!hasStoredPrefs) {
        const isMobile = window.innerWidth < 768;
        const isCompact = window.innerHeight < 500;
        if (!isMobile && !isCompact) {
          setShowSide(true);
          setShowTimeline(true);
        }
        setShowToolbar(true);
      }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  // ─── Persist panel state ────────────────────────────────────────────────
  useEffect(() => { try { localStorage.setItem("record-panel-inspector", showSide); } catch {} }, [showSide]);
  useEffect(() => { try { localStorage.setItem("record-panel-timeline", showTimeline); } catch {} }, [showTimeline]);
  useEffect(() => { try { localStorage.setItem("record-panel-controls", showToolbar); } catch {} }, [showToolbar]);
  useEffect(() => { try { localStorage.setItem("record-panel-layout", layoutMode); } catch {} }, [layoutMode]);

  // ─── Drag and drop ──────────────────────────────────────────────────────
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer?.files?.[0];
    if (file) loadTrace(file);
  }, [loadTrace]);

  const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); };

  const handleFileInput = (e) => {
    const file = e.target.files?.[0];
    if (file) loadTrace(file);
  };

  // ─── Auto-load trace from URL param ─────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const traceUrl = params.get("record");
    if (traceUrl) {
      const url = traceUrl.startsWith("http") ? traceUrl : `/${traceUrl}`;
      fetch(url)
        .then(r => { if (!r.ok) throw new Error(`Failed to fetch ${traceUrl}`); return r.blob(); })
        .then(blob => loadTrace(blob))
        .catch(e => setError(e.message));
    }
  }, []);

  // ─── Playback ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying || !traceData) return;
    let startTime = performance.now();
    let startPos = playhead;
    const tick = (now) => {
      let newPos = startPos + (now - startTime) * speed;
      if (newPos >= traceData.duration) {
        if (loop) {
          // Reset origin and keep going
          startPos = 0;
          startTime = now;
          newPos = 0;
        } else {
          setPlayhead(traceData.duration);
          setIsPlaying(false);
          return;
        }
      }
      setPlayhead(newPos);
      playRef.current = requestAnimationFrame(tick);
    };
    playRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(playRef.current);
  }, [isPlaying, traceData, speed, loop]);

  // ─── Auto-scroll timeline to keep playhead visible ─────────────────────
  useEffect(() => {
    if (!scrollRef.current || !traceData) return;
    const el = scrollRef.current;
    const contentW = el.scrollWidth;
    const viewW = el.clientWidth;
    if (contentW <= viewW) return; // no scroll needed
    const playheadX = 56 + (playhead / (traceData.duration || 1)) * (contentW - 56);
    const margin = viewW * 0.3; // keep playhead ~30% from edges
    const speed = dragging.current ? 0.08 : 0.18; // lerp factor (slow & smooth)
    if (playheadX < el.scrollLeft + margin) {
      const target = Math.max(0, playheadX - margin);
      el.scrollLeft += (target - el.scrollLeft) * speed;
    } else if (playheadX > el.scrollLeft + viewW - margin) {
      const target = playheadX - viewW + margin;
      el.scrollLeft += (target - el.scrollLeft) * speed;
    }
  }, [playhead, traceData]);

  // ─── Filtered actions ──────────────────────────────────────────────────
  const filteredActions = useMemo(() => {
    if (!traceData) return [];
    if (actionFilter === "all") return traceData.actions;
    return traceData.actions.filter(a => isHumanAction(a.apiName));
  }, [traceData, actionFilter]);

  // ─── Global keyboard shortcuts (always active) ─────────────────────────
  useEffect(() => { helpRef.current = showHelp; }, [showHelp]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "d" || e.key === "D" || e.key === "l" || e.key === "L") { setDark(prev => !prev); }
      if (e.key === "?") { setShowHelp(prev => !prev); }
      if (e.key === "Escape") { setShowHelp(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ─── Navigation stops: start AND end of each visible action ─────────
  const navStops = useMemo(() => {
    const stops = [];
    for (const a of filteredActions) {
      stops.push({ time: a.startTime || 0, action: a });
      if ((a.endTime || 0) > (a.startTime || 0) + 1) {
        stops.push({ time: a.endTime, action: a });
      }
    }
    stops.sort((a, b) => a.time - b.time);
    return stops;
  }, [filteredActions]);

  // ─── Keyboard navigation ──────────────────────────────────────────────
  useEffect(() => {
    if (!traceData) return;
    const onKey = (e) => {
      if (helpRef.current) return;
      const key = e.key;
      if (key === "ArrowLeft" || key === "ArrowUp") {
        e.preventDefault();
        setIsPlaying(false);
        let prev = null;
        for (let i = navStops.length - 1; i >= 0; i--) {
          if (navStops[i].time < playhead - 10) { prev = navStops[i]; break; }
        }
        setPlayhead(prev ? prev.time : 0);
        if (prev) setSelectedAction(prev.action);
      }
      if (key === "ArrowRight" || key === "ArrowDown") {
        e.preventDefault();
        setIsPlaying(false);
        let next = null;
        for (const s of navStops) {
          if (s.time > playhead + 10) { next = s; break; }
        }
        setPlayhead(next ? next.time : traceData.duration);
        if (next) setSelectedAction(next.action);
      }
      if (key === " ") {
        e.preventDefault();
        setIsPlaying((p) => !p);
      }
      if (key === "Home") { e.preventDefault(); setPlayhead(0); setIsPlaying(false); }
      if (key === "End") { e.preventDefault(); setPlayhead(traceData.duration); setIsPlaying(false); }
      if (key >= "0" && key <= "9") { e.preventDefault(); setPlayhead(traceData.duration * parseInt(key) / 10); setIsPlaying(false); }
      if (key === "h" || key === "H") { e.preventDefault(); setOverlayEnabled((v) => !v); }
      if (key === "c" || key === "C") { e.preventDefault(); setShowToolbar((v) => !v); }
      if (key === "t" || key === "T") { e.preventDefault(); setShowTimeline((v) => !v); }
      if (key === "i" || key === "I") { e.preventDefault(); setShowSide((v) => !v); }
      if (key === "v" || key === "V") { e.preventDefault(); setLayoutMode((m) => m === "main" ? "stacked" : "main"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [traceData, playhead, filteredActions]);

  // ─── Timeline scrub ────────────────────────────────────────────────────
  const handleScrub = useCallback((e) => {
    if (!scrollRef.current || !traceData) return;
    const rect = scrollRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollRef.current.scrollLeft - 56; // offset by label gutter
    const tw = scrollRef.current.scrollWidth - 56;
    setPlayhead(Math.max(0, Math.min(traceData.duration, (x / tw) * traceData.duration)));
  }, [traceData]);

  // ─── Current screenshot ─────────────────────────────────────────────────
  const currentScreenshot = useMemo(() => {
    if (!traceData) return null;
    let best = null;
    for (const s of traceData.screenshots) {
      if (s.time <= playhead && s.url) best = s;
    }
    return best;
  }, [playhead, traceData]);

  // ─── Current action ─────────────────────────────────────────────────────
  const currentAction = useMemo(() => {
    if (!traceData) return null;

    // Multiple actions can overlap; choose the most recent one at playhead.
    const candidates = traceData.actions.filter((a) => playhead >= (a.startTime || 0) - 20 && playhead <= (a.endTime || a.startTime || 0) + 220);
    if (!candidates.length) return null;

    return candidates.reduce((best, a) => {
      if (!best) return a;
      const aStart = a.startTime || 0;
      const bStart = best.startTime || 0;
      return aStart >= bStart ? a : best;
    }, null);
  }, [playhead, traceData]);

  const currentGroup = useMemo(() => {
    if (!traceData?.groups) return null;
    for (const g of traceData.groups) {
      if (playhead >= g.startTime && playhead <= g.endTime) return g;
    }
    return null;
  }, [playhead, traceData]);

  // ─── Sync detail pane with playhead (only during playback) ───────────
  useEffect(() => {
    if (isPlaying && currentAction) setSelectedAction(currentAction);
  }, [currentAction, isPlaying]);

  // ─── Scroll timeline to selected action ─────────────────────────────
  useEffect(() => {
    if (!selectedAction || !scrollRef.current || !traceData) return;
    const container = scrollRef.current;
    const labelW = 56;
    const innerW = container.scrollWidth;
    const contentW = innerW - labelW;
    const actionPx = labelW + ((selectedAction.startTime || 0) / (traceData.duration || 1)) * contentW;
    const centerOffset = actionPx - container.clientWidth / 2;
    container.scrollTo({ left: Math.max(0, centerOffset), behavior: "smooth" });
  }, [selectedAction, traceData, zoom]);

  // ─── Timeline ticks ────────────────────────────────────────────────────
  const ticks = useMemo(() => {
    if (!traceData) return [];
    const dur = traceData.duration;
    const iv = dur > 30000 ? 5000 : dur > 10000 ? 2000 : dur > 5000 ? 1000 : 500;
    const arr = [];
    for (let t = 0; t <= dur; t += iv) arr.push(t);
    return arr;
  }, [traceData, zoom]);

  // ─── Drop zone (no trace loaded) ──────────────────────────────────────
  if (!traceData) {
    return (
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        style={{
          width: "100%", height: "100vh", background: V.bg, color: V.text,
          fontFamily: "'SF Mono', 'Fira Code', monospace",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 20,
        }}
      >
        {/* Theme toggle */}
        <button onClick={() => setDark(!dark)} style={{ position: "absolute", top: 16, right: 16, background: V.bgCard, border: `1px solid ${V.border}`, color: V.textMid, cursor: "pointer", padding: "5px 10px", borderRadius: 6, fontSize: 15, fontFamily: "inherit" }}>
          {dark ? "☀︎" : "☾"}
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img
            src={VIBIUM_LOGO_HI} alt="V"
            onClick={() => { if (mobile) setLogoSpinning(s => !s); }}
            onMouseEnter={() => { if (!mobile) setLogoSpinning(true); }}
            onMouseLeave={() => { if (!mobile) setLogoSpinning(false); }}
            style={{
              width: 48, height: 62, cursor: mobile ? "pointer" : "default",
              animation: logoSpinning ? "spin-record 3s linear infinite" : "none",
              transition: "transform 0.3s ease-out",
            }}
          />
          <span style={{ fontSize: 24, fontWeight: 700, color: V.orange }}>Vibium Record Player</span>
        </div>
        <div style={{ fontSize: 14, color: V.textDim, marginTop: -4 }}>player.vibium.dev</div>
        <div style={{ color: V.textDim, fontSize: 17 }}>Drop a Vibium <code style={{ background: V.bgCard, padding: "2px 6px", borderRadius: 4, color: V.amber }}>record.zip</code> here</div>

        <div style={{
          width: 320, height: 160, border: `2px dashed ${V.border}`, borderRadius: 12,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 12, cursor: "pointer", transition: "border-color 0.2s",
        }}
          onMouseEnter={(e) => e.currentTarget.style.borderColor = V.orange}
          onMouseLeave={(e) => e.currentTarget.style.borderColor = V.border}
        >
          <div style={{ fontSize: 36, opacity: 0.3 }}>📁</div>
          <div style={{ color: V.textDim, fontSize: 15 }}>Drag & drop or click to browse</div>
          <input type="file" accept=".zip" onChange={handleFileInput} style={{ position: "absolute", opacity: 0, width: 320, height: 160, cursor: "pointer", outline: "none" }} />
        </div>

        <div style={{ color: V.textDim, fontSize: 14, marginTop: 4 }}>
          Or <a href="/?record=vibium-demo-record.zip" style={{ color: V.orange, textDecoration: "none" }}>play a sample recording</a>
        </div>

        {loading && <div style={{ color: V.orange, fontSize: 16 }}>Loading trace...</div>}
        {error && <div style={{ color: "#ef4444", fontSize: 15, maxWidth: 400, textAlign: "center" }}>Error: {error}</div>}

        <div style={{ color: V.textDim, fontSize: 14, maxWidth: 440, textAlign: "center", lineHeight: 1.6, marginTop: 8 }}>
          Use <code style={{ background: V.bgCard, padding: "1px 4px", borderRadius: 3, color: V.amber }}>Vibium API</code>, <code style={{ background: V.bgCard, padding: "1px 4px", borderRadius: 3, color: V.amber }}>MCP</code>, or <code style={{ background: V.bgCard, padding: "1px 4px", borderRadius: 3, color: V.amber }}>CLI</code> + <code style={{ background: V.bgCard, padding: "1px 4px", borderRadius: 3, color: V.orange }}>Skill</code> to generate traces.<br />
          <a href="https://github.com/VibiumDev/vibium/" target="_blank" rel="noopener noreferrer" style={{ color: V.orange, textDecoration: "none" }}>github.com/VibiumDev/vibium</a>
        </div>

        <button onClick={() => setShowHelp(true)} style={{ background: V.bgCard, border: `1px solid ${V.border}`, color: V.textDim, cursor: "pointer", padding: "5px 12px", borderRadius: 6, fontSize: 13, fontFamily: "inherit", marginTop: 4 }}>
          Keyboard shortcuts <kbd style={{ marginLeft: 6, padding: "1px 5px", borderRadius: 4, background: V.bg, border: `1px solid ${V.border}`, fontSize: 12 }}>?</kbd>
        </button>

        {/* Help overlay */}
        {showHelp && (
          <div onClick={() => setShowHelp(false)} style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div onClick={(e) => e.stopPropagation()} style={{
              background: V.bgCard, border: `1px solid ${V.border}`, borderRadius: 12,
              padding: "28px 36px", maxWidth: 520, width: "90%", color: V.text,
              boxShadow: "0 20px 60px rgba(0,0,0,0.4)", maxHeight: "85vh", overflowY: "auto",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: V.orange }}>Keyboard Shortcuts</span>
                <span onClick={() => setShowHelp(false)} style={{ cursor: "pointer", color: V.textDim, fontSize: 20, lineHeight: 1 }}>✕</span>
              </div>
              <div>
              {[
                ["General", [
                  ["D / L", "Toggle dark / light mode"],
                  ["?", "Show this help"],
                  ["Esc", "Close this help"],
                ]],
              ].map(([section, shortcuts]) => (
                <div key={section} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: V.textDim, marginBottom: 8 }}>{section}</div>
                  {shortcuts.map(([key, desc]) => (
                    <div key={key} style={{ display: "flex", alignItems: "center", padding: "4px 0", gap: 12 }}>
                      <kbd style={{ display: "inline-block", minWidth: 48, textAlign: "center", padding: "3px 8px", borderRadius: 5, fontSize: 12, fontFamily: "inherit", fontWeight: 600, background: V.bg, border: `1px solid ${V.border}`, color: V.textMid }}>{key}</kbd>
                      <span style={{ fontSize: 13, color: V.textMid }}>{desc}</span>
                    </div>
                  ))}
                </div>
              ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Main viewer ──────────────────────────────────────────────────────
  const D = traceData.duration || 1;

  return (
    <div onDrop={handleDrop} onDragOver={handleDragOver} style={{ width: "100%", height: "100vh", background: V.bg, color: V.text, fontFamily: "'SF Mono', 'Fira Code', monospace", display: "flex", flexDirection: "column", overflow: "hidden", fontSize: 16, userSelect: "none" }}>
      <style>{`.hide-scrollbar::-webkit-scrollbar{display:none}.hide-scrollbar{scrollbar-width:none}@keyframes spin-record{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>

      {/* ─── Top bar ───────────────────────────────────────────── */}
      {showToolbar ? (<div style={{ height: mobile ? 52 : 66, background: V.bgCard, borderBottom: `1px solid ${V.border}`, display: "flex", alignItems: "center", padding: mobile ? "0 8px" : "0 14px", gap: mobile ? 6 : 12, flexShrink: 0, position: "relative" }}>
        <img src={VIBIUM_LOGO} alt="V" style={{ width: 22, height: 28, borderRadius: 4 }} />
        {!mobile && <span style={{ fontWeight: 700, fontSize: 16, color: V.orange }}>Vibium Player</span>}
        <div style={{ flex: 1 }} />

        <div style={{ display: "flex", alignItems: "center", gap: 2, background: V.bgPanel, border: `1px solid ${V.border}`, borderRadius: 10, padding: "2px 4px" }}>
          <button onClick={() => { setPlayhead(0); setIsPlaying(false); }} style={{ background: "none", border: "none", color: V.textDim, cursor: "pointer", padding: "3px 8px", borderRadius: 6, fontSize: 20, outline: "none" }}>⏮</button>
          {mobile && <button onClick={() => { setIsPlaying(false); const prev = [...filteredActions].reverse().find(a => a.startTime < playhead - 10); setPlayhead(prev ? (prev.endTime || prev.startTime) : 0); if (prev) setSelectedAction(prev); }} style={{ background: "none", border: "none", color: V.textDim, cursor: "pointer", padding: "3px 6px", borderRadius: 6, fontSize: 16, outline: "none" }}>◀</button>}
          <button onClick={() => setIsPlaying(!isPlaying)} style={{ background: isPlaying ? V.orange : "none", border: "none", color: isPlaying ? "#fff" : V.textDim, cursor: "pointer", width: 48, height: 36, borderRadius: 8, fontSize: 24, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", outline: "none" }}>{isPlaying ? "⏸" : "▶"}</button>
          {mobile && <button onClick={() => { setIsPlaying(false); const next = filteredActions.find(a => a.startTime > playhead + 10); if (next) { setPlayhead(next.endTime || next.startTime); setSelectedAction(next); } }} style={{ background: "none", border: "none", color: V.textDim, cursor: "pointer", padding: "3px 6px", borderRadius: 6, fontSize: 16, outline: "none" }}>▶</button>}
          <button onClick={() => { setPlayhead(D); setIsPlaying(false); }} style={{ background: "none", border: "none", color: V.textDim, cursor: "pointer", padding: "3px 8px", borderRadius: 6, fontSize: 20, outline: "none" }}>⏭</button>
          {!mobile && <>
            <div style={{ width: 1, height: 16, background: V.border, margin: "0 2px" }} />
            <button onClick={() => setLoop(!loop)} title={loop ? "Loop on" : "Loop off"} style={{ background: loop ? V.orange + "18" : "none", border: loop ? `1px solid ${V.orange}40` : "1px solid transparent", color: loop ? V.orange : V.textDim, cursor: "pointer", padding: "3px 8px", borderRadius: 6, fontSize: 20, fontWeight: 700, outline: "none" }}>⟲</button>
          </>}
        </div>

        <div style={{ fontVariantNumeric: "tabular-nums", fontSize: mobile ? 14 : 18, fontWeight: 600, background: V.bg, border: `1px solid ${V.border}`, borderRadius: 6, padding: mobile ? "3px 8px" : "4px 12px", minWidth: mobile ? 64 : 90, textAlign: "center", color: V.orange }}>{fmt(playhead)}</div>
        {!mobile && <span style={{ color: V.textDim, fontSize: 14 }}>/ {fmt(D)}</span>}

        {!mobile && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, background: V.bgPanel, border: `1px solid ${V.border}`, borderRadius: 6, padding: "3px 8px" }}>
            <input type="range" min={0.1} max={5} step={0.1} value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))} style={{ width: 52, accentColor: V.orange, height: 2, cursor: "pointer", outline: "none" }} />
            <span style={{ fontSize: 12, color: speed === 1 ? V.textDim : V.orange, fontVariantNumeric: "tabular-nums", minWidth: 30, textAlign: "center", fontWeight: speed !== 1 ? 700 : 400 }}>{speed.toFixed(1)}×</span>
          </div>
        )}

        <div style={{ flex: 1 }} />

        <button
          onClick={() => setOverlayEnabled(!overlayEnabled)}
          title={overlayEnabled ? "Disable highlight" : "Enable highlight"}
          style={{ background: overlayEnabled ? V.orange + "18" : "none", border: overlayEnabled ? `1px solid ${V.orange}40` : "1px solid transparent", color: overlayEnabled ? V.orange : V.textDim, cursor: "pointer", padding: "3px 8px", borderRadius: 6, fontSize: 20, fontWeight: 700, fontFamily: "inherit", transition: "all 0.15s", outline: "none" }}
        >🔦</button>
        {!mobile && <button
          onClick={() => setLayoutMode(m => m === "main" ? "stacked" : "main")}
          title={layoutMode === "main" ? "Stacked layout (V)" : "Default layout (V)"}
          style={{ background: layoutMode === "stacked" ? V.orange + "18" : "none", border: layoutMode === "stacked" ? `1px solid ${V.orange}40` : "1px solid transparent", color: layoutMode === "stacked" ? V.orange : V.textDim, cursor: "pointer", padding: "3px 8px", borderRadius: 6, fontSize: 20, fontWeight: 700, fontFamily: "inherit", transition: "all 0.15s", outline: "none" }}
        >{layoutMode === "stacked" ? "▤" : "▥"}</button>}
        <button
          onClick={() => { setTraceData(null); setFileList([]); }}
          style={{ background: V.bgCard, border: `1px solid ${V.border}`, color: V.textDim, cursor: "pointer", padding: "4px 10px", borderRadius: 4, fontSize: mobile ? 12 : 14, fontFamily: "inherit" }}
        >{mobile ? "⏏" : "⏏ Eject"}</button>
        {!mobile && <button
          onClick={() => setDark(!dark)}
          style={{ background: V.bgPanel, border: `1px solid ${V.border}`, color: V.textMid, cursor: "pointer", padding: "4px 10px", borderRadius: 4, fontSize: 14, fontFamily: "inherit" }}
        >{dark ? "☀︎" : "☾"}</button>}
        {/* Collapse toolbar chevron */}
        <div data-chevron="1" onClick={() => setShowToolbar(false)} style={{
          position: "absolute", bottom: -8, left: "50%", transform: "translateX(-50%)",
          width: 28, height: 16, borderRadius: 4, background: V.bgCard, border: `1px solid ${V.border}`,
          display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 10,
          transition: "background 0.15s",
        }}
          onMouseEnter={(e) => e.currentTarget.style.background = V.bgPanel}
          onMouseLeave={(e) => e.currentTarget.style.background = V.bgCard}
        >
          <span style={{ fontSize: 13, color: V.textDim }}>▴</span>
        </div>
      </div>) : (
        /* Collapsed toolbar — expand chevron */
        <div onClick={() => setShowToolbar(true)} style={{
          height: 20, flexShrink: 0, background: V.bgPanel, borderBottom: `1px solid ${V.border}`,
          display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
          transition: "background 0.15s",
        }}
          onMouseEnter={(e) => e.currentTarget.style.background = V.bgCard}
          onMouseLeave={(e) => e.currentTarget.style.background = V.bgPanel}
        >
          <span style={{ fontSize: 13, color: V.textDim }}>▾</span>
        </div>
      )}

      {/* ─── Main area ─────────────────────────────────────────── */}
      <div ref={mainAreaRef} style={{ flex: 1, display: "flex", flexDirection: layoutMode === "stacked" ? "column" : "row", overflow: "hidden", minHeight: 0 }}>

        {/* Preview area */}
        <div style={{ flex: (layoutMode === "stacked" && showSide) ? "none" : 1, height: (layoutMode === "stacked" && showSide) ? (screenshotH || "50%") : undefined, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
          {/* Screenshot preview */}
          <div
            onTouchStart={(e) => { const t = e.touches[0]; touchRef.current = { startX: t.clientX, startY: t.clientY }; }}
            onTouchEnd={(e) => {
              const t = e.changedTouches[0];
              const dx = t.clientX - touchRef.current.startX;
              const dy = t.clientY - touchRef.current.startY;
              if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                          setIsPlaying(false);
                const sorted = filteredActions;
                if (dx < 0) { /* swipe left = next */
                  const next = sorted.find(a => a.startTime > playhead + 10);
                  if (next) { setPlayhead(next.endTime || next.startTime); setSelectedAction(next); }
                } else { /* swipe right = prev */
                  let prev = null;
                  for (let i = sorted.length - 1; i >= 0; i--) {
                    if (sorted[i].startTime < playhead - 10) { prev = sorted[i]; break; }
                  }
                  setPlayhead(prev ? (prev.endTime || prev.startTime) : 0);
                  if (prev) setSelectedAction(prev);
                }
              }
            }}
            ref={screenshotContainerRef}
            style={{ flex: 1, background: V.bg, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden", touchAction: "pan-y" }}>
            {/* Current group label */}
            {overlayEnabled && playhead > 0 && currentGroup && (
              <div style={{ position: "absolute", top: 8, left: 12, zIndex: 10, padding: "4px 10px", background: V.overlayBg, backdropFilter: "blur(8px)", borderRadius: 6, pointerEvents: "none" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: V.purple, letterSpacing: "0.02em" }}>{currentGroup.title}</span>
              </div>
            )}
            {currentScreenshot?.url ? (
              <>
                <img
                  ref={imgRef}
                  src={currentScreenshot.url}
                  onLoad={(e) => { setImgDims({ w: e.currentTarget.clientWidth, h: e.currentTarget.clientHeight }); }}
                  style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 4, display: "block" }}
                  alt="trace screenshot"
                />
                {overlayEnabled && <ActionOverlay action={(() => { const a = selectedAction || currentAction; if (!a) return null; const start = a.startTime || 0; const end = a.endTime || start; return playhead >= start - 50 && playhead < end ? a : null; })()} screenshot={currentScreenshot} viewport={traceData?.contextOptions?.options?.viewport || (currentScreenshot?.width && currentScreenshot?.height ? { width: currentScreenshot.width, height: currentScreenshot.height } : traceData?.fallbackViewport)} dpr={traceData?.contextOptions?.options?.deviceScaleFactor} imgEl={imgRef.current} containerEl={screenshotContainerRef.current} showDebug={false} layoutKey={`${showSide}-${sideW}-${showTimeline}-${timelineH}-${showDetail}-${detailH}-${layoutMode}-${screenshotH}`} />}
                {overlayEnabled && <PersistentCursor action={(() => { const actions = traceData?.actions || []; let best = null; for (const a of actions) { if (a.point && (a.startTime || 0) <= playhead + 50) best = a; } return best; })()} screenshot={currentScreenshot} viewport={traceData?.contextOptions?.options?.viewport || (currentScreenshot?.width && currentScreenshot?.height ? { width: currentScreenshot.width, height: currentScreenshot.height } : traceData?.fallbackViewport)} dpr={traceData?.contextOptions?.options?.deviceScaleFactor} imgEl={imgRef.current} containerEl={screenshotContainerRef.current} layoutKey={`${showSide}-${sideW}-${showTimeline}-${timelineH}-${showDetail}-${detailH}-${layoutMode}-${screenshotH}`} />}
              </>
            ) : (
              <div style={{ textAlign: "center", color: V.border }}>
                {traceData.screenshots.filter(s => s.url).length === 0 ? (
                  <>
                    <div style={{ fontSize: 52, marginBottom: 8 }}>◻</div>
                    <div style={{ fontSize: 15, color: V.textDim }}>No screenshots in this trace</div>
                  </>
                ) : (
                  <>
                    <div
                      onClick={() => { setPlayhead(0); setIsPlaying(true); if (!mobile && !compact) { setShowTimeline(true); setShowSide(true); } }}
                      style={{ width: 80, height: 80, borderRadius: "50%", background: V.orange, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", margin: "0 auto 16px", boxShadow: `0 0 30px ${V.orange}40`, transition: "transform 0.15s, box-shadow 0.15s" }}
                      onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.08)"; e.currentTarget.style.boxShadow = `0 0 40px ${V.orange}60`; }}
                      onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = `0 0 30px ${V.orange}40`; }}
                    >
                      <span style={{ fontSize: 36, color: "#fff", marginLeft: 4 }}>▶</span>
                    </div>
                    <div style={{ fontSize: 16, color: V.textMid, fontWeight: 600, marginBottom: 6 }}>
                      {traceData.contextOptions?.title || "Trace loaded"}
                    </div>
                    <div style={{ fontSize: 13, color: V.textDim }}>
                      {traceData.actions.length} actions · {(traceData.duration / 1000).toFixed(1)}s · {traceData.screenshots.filter(s => s.url).length} frames
                    </div>
                    <div style={{ fontSize: 12, color: V.textDim, marginTop: 8 }}>
                      {mobile ? "Swipe ← → to step through actions" : "Press play or use ← → to step through actions · L/D to toggle theme"}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Current action overlay */}
            {overlayEnabled && playhead > 0 && currentAction && (
              <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", background: V.overlayBg, backdropFilter: "blur(12px)", border: `1px solid ${actionColor(currentAction.apiName)}50`, borderRadius: 8, padding: "8px 16px", display: "flex", alignItems: "center", gap: 8, zIndex: 10, maxWidth: "80%" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: actionColor(currentAction.apiName), whiteSpace: "nowrap" }}>{humanizeAction(currentAction)}</span>
              </div>
            )}
          </div>

        </div>

        {/* ─── Stacked mode: horizontal divider with collapse chevron ─── */}
        {layoutMode === "stacked" && showSide && (
          <div
            onMouseDown={(e) => { if (e.target.dataset.chevron) return; e.preventDefault(); stackedDrag.current = true; stackedDragStart.current = { y: e.clientY, h: typeof screenshotH === "number" ? screenshotH : (mainAreaRef.current?.clientHeight || 400) * 0.5 }; document.body.style.cursor = "row-resize"; }}
            onTouchStart={(e) => { if (e.target.dataset.chevron) return; const t = e.touches[0]; stackedDrag.current = true; stackedDragStart.current = { y: t.clientY, h: typeof screenshotH === "number" ? screenshotH : (mainAreaRef.current?.clientHeight || 400) * 0.5 }; }}
            style={{ height: mobile ? 24 : 9, flexShrink: 0, cursor: "row-resize", background: "transparent", position: "relative", zIndex: 20, display: "flex", alignItems: "center", justifyContent: "center", touchAction: "none" }}
          >
            <div style={{ position: "absolute", top: mobile ? 11 : 4, left: 0, right: 0, height: 1, background: V.border, transition: "background 0.15s" }}
              onMouseEnter={(e) => e.currentTarget.style.background = V.orange}
              onMouseLeave={(e) => e.currentTarget.style.background = V.border}
            />
            <div data-chevron="1" onClick={() => setShowSide(false)} style={{
              position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
              width: 28, height: 16, borderRadius: 4, background: V.bgCard, border: `1px solid ${V.border}`,
              display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
              fontSize: 13, color: V.textDim, zIndex: 21, transition: "color 0.15s, border-color 0.15s",
            }}
              onMouseEnter={(e) => { e.currentTarget.style.color = V.orange; e.currentTarget.style.borderColor = V.orange; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = V.textDim; e.currentTarget.style.borderColor = V.border; }}
            >▾</div>
          </div>
        )}

        {/* ─── Side panel / Stacked inspector ─────────────────────────────── */}
        {showSide ? (<>
          {/* Resize handle with collapse chevron (main layout only) */}
          {layoutMode === "main" && (
          <div
            onMouseDown={(e) => { if (e.target.dataset.chevron) return; e.preventDefault(); sideDrag.current = true; document.body.style.cursor = "col-resize"; }}
            onTouchStart={(e) => { if (e.target.dataset.chevron) return; sideDrag.current = true; }}
            style={{ width: mobile ? 24 : 9, flexShrink: 0, cursor: "col-resize", background: "transparent", position: "relative", zIndex: 20, display: "flex", alignItems: "center", justifyContent: "center", touchAction: "none" }}
          >
            <div style={{ position: "absolute", left: mobile ? 11 : 4, top: 0, bottom: 0, width: 1, background: V.border, transition: "background 0.15s" }}
              onMouseEnter={(e) => e.currentTarget.style.background = V.orange}
              onMouseLeave={(e) => e.currentTarget.style.background = V.border}
            />
            <div data-chevron="1" onClick={() => setShowSide(false)} style={{
              position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
              width: 16, height: 28, borderRadius: 4, background: V.bgCard, border: `1px solid ${V.border}`,
              display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
              fontSize: 13, color: V.textDim, zIndex: 21, transition: "color 0.15s, border-color 0.15s",
            }}
              onMouseEnter={(e) => { e.currentTarget.style.color = V.orange; e.currentTarget.style.borderColor = V.orange; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = V.textDim; e.currentTarget.style.borderColor = V.border; }}
            >▸</div>
          </div>
          )}
          <div style={{ width: layoutMode === "stacked" ? undefined : sideW, flex: layoutMode === "stacked" ? 1 : undefined, flexShrink: 0, background: V.bgPanel, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
          <div style={{ display: "flex", borderBottom: `1px solid ${V.border}`, flexShrink: 0 }}>
            {[
              { key: "actions", label: `Actions (${filteredActions.length})`, color: V.orange },
              { key: "network", label: `Net (${traceData.network.length})`, color: "#22c55e" },
              { key: "console", label: `Log (${traceData.console.length})`, color: V.sunset },
              { key: "files", label: "Info", color: V.textDim },
            ].map(tab => (
              <button key={tab.key} onClick={() => setActivePanel(tab.key)} style={{
                flex: 1, background: "none", border: "none",
                borderBottom: activePanel === tab.key ? `2px solid ${tab.color}` : "2px solid transparent",
                color: activePanel === tab.key ? tab.color : V.textDim, cursor: "pointer",
                padding: "10px 0", fontSize: 13, fontWeight: 600, fontFamily: "inherit", outline: "none",
              }}>{tab.label}</button>
            ))}
          </div>

          {/* Actions filter bar — fixed above scroll area */}
          {activePanel === "actions" && (
            <div style={{ display: "flex", gap: 2, padding: "4px 4px", borderBottom: `1px solid ${V.border}`, flexShrink: 0, background: V.bgPanel }}>
              <button onClick={() => {
                const all = new Set((traceData.groups || []).map(g => g.title));
                setCollapsedGroups(all);
              }} style={{
                background: "transparent", border: `1px solid ${V.border}`, color: V.textDim, cursor: "pointer",
                padding: "4px 8px", borderRadius: 4, fontSize: 12, fontFamily: "inherit", outline: "none",
              }} title="Collapse all groups">▸</button>
              <button onClick={() => setCollapsedGroups(new Set())} style={{
                background: "transparent", border: `1px solid ${V.border}`, color: V.textDim, cursor: "pointer",
                padding: "4px 8px", borderRadius: 4, fontSize: 12, fontFamily: "inherit", outline: "none",
              }} title="Expand all groups">▾</button>
              <div style={{ width: 1, background: V.border, margin: "0 2px" }} />
              {[
                { key: "human", label: "👤 User" },
                { key: "all", label: "All" },
              ].map(f => (
                <button key={f.key} onClick={() => setActionFilter(f.key)} style={{
                  flex: 1, background: actionFilter === f.key ? V.orange + "18" : "transparent",
                  border: `1px solid ${actionFilter === f.key ? V.orange + "40" : V.border}`,
                  color: actionFilter === f.key ? V.orange : V.textDim, cursor: "pointer",
                  padding: "4px 0", borderRadius: 4, fontSize: 13, fontWeight: 600, fontFamily: "inherit", outline: "none",
                }}>{f.label}</button>
              ))}
            </div>
          )}

          <div style={{ flex: 1, overflowY: "auto", padding: 4, userSelect: "text" }}>
            {/* Actions panel */}
            {activePanel === "actions" && (() => {
              const groups = traceData.groups || [];
              // Merge group starts/ends and actions into timeline order
              const allItems = [
                ...groups.map(g => ({ type: 'group-start', time: g.startTime, order: 1, group: g })),
                ...groups.map(g => ({ type: 'group-end', time: g.endTime, order: 0, group: g })),
                ...filteredActions.map(a => ({ type: 'action', time: a.startTime, order: 2, action: a })),
              ].sort((a, b) => a.time - b.time || a.order - b.order);

              let depth = 0;
              const activeGroupStack = []; // track which groups we're inside
              return allItems.map((item, i) => {
                if (item.type === 'group-start') {
                  const g = item.group;
                  const isActive = playhead >= g.startTime && playhead <= g.endTime;
                  const isCollapsed = collapsedGroups.has(g.title);
                  activeGroupStack.push(g.title);
                  depth++;
                  // Count actions in this group
                  const childCount = filteredActions.filter(a => a.startTime >= g.startTime && a.endTime <= g.endTime).length;
                  return (
                    <div key={`gs-${i}`} onClick={() => {
                        setCollapsedGroups(prev => {
                          const next = new Set(prev);
                          if (next.has(g.title)) next.delete(g.title); else next.add(g.title);
                          return next;
                        });
                      }} style={{
                      position: "relative",
                      display: "flex", alignItems: "center", gap: 6, padding: "4px 6px", marginTop: i > 0 ? 4 : 0, marginBottom: 2, cursor: "pointer",
                      borderLeft: `3px solid ${V.purple}${isActive ? "" : "50"}`, borderRadius: "0 4px 4px 0",
                      background: isActive ? V.purple + "12" : "transparent",
                    }}>
                      <span style={{ fontSize: 12, color: V.purple, fontWeight: 700, width: 12, textAlign: "center", flexShrink: 0 }}>{isCollapsed ? "▸" : "▾"}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: isActive ? V.purple : V.textMid, flex: 1 }}>{g.title}</span>
                      {isCollapsed && <span style={{ fontSize: 11, color: V.textDim, background: V.bgCard, padding: "1px 6px", borderRadius: 8 }}>{childCount}</span>}
                      <span style={{ fontSize: 12, color: V.textDim, flexShrink: 0 }}>{fmt(g.startTime)}</span>
                      {isCollapsed && playhead >= g.startTime && playhead <= g.endTime && (() => {
                        const groupDuration = g.endTime - g.startTime;
                        const progress = groupDuration > 0 ? Math.min(1, Math.max(0, (playhead - g.startTime) / groupDuration)) : 0;
                        return (
                          <div style={{
                            position: "absolute", bottom: 0, left: 0, right: 0, height: 2,
                            background: V.border, borderRadius: 1, overflow: "hidden",
                          }}>
                            <div style={{
                              width: `${progress * 100}%`, height: "100%",
                              background: V.purple, borderRadius: 1,
                            }} />
                          </div>
                        );
                      })()}
                    </div>
                  );
                }
                if (item.type === 'group-end') {
                  activeGroupStack.pop();
                  depth = Math.max(0, depth - 1);
                  return null;
                }
                // Action — skip if any parent group is collapsed
                if (activeGroupStack.some(title => collapsedGroups.has(title))) return null;
                const a = item.action;
                const isActive = playhead >= a.startTime && playhead <= a.endTime + 200;
                const isPast = playhead > a.endTime + 200;
                const c = actionColor(a.apiName);
                return (
                  <div key={`a-${i}`} ref={(isActive || selectedAction === a) ? (el) => el?.scrollIntoView?.({ block: "center", behavior: "smooth" }) : undefined} onClick={() => { setPlayhead(a.endTime || a.startTime); setSelectedAction(a); }} style={{
                    position: "relative",
                    display: "flex", alignItems: "center", gap: 6, padding: "5px 6px", paddingLeft: 6 + depth * 20, borderRadius: 5, marginBottom: 1, cursor: "pointer",
                    background: isActive ? c + "15" : selectedAction === a ? c + "08" : "transparent",
                    border: isActive ? `1px solid ${c}30` : "1px solid transparent",
                    opacity: isPast && !isActive ? 0.45 : 1,
                    transition: "opacity 0.15s, background 0.15s",
                  }}>
                    <div style={{ width: 4, height: 4, borderRadius: "50%", background: a.error ? "#ef4444" : c, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: isActive ? c : V.textAction }}>{a.apiName || "action"}</div>
                      <div style={{ fontSize: 12, color: V.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {a.params?.selector || a.params?.url || (() => {
                          const ps = { ...a.params };
                          delete ps.context;
                          if (maskSensitive && ps.value && isSensitiveField(ps.selector)) ps.value = "••••••";
                          return JSON.stringify(ps).slice(0, 50);
                        })()}
                      </div>
                    </div>
                    <span style={{ fontSize: 12, color: V.textDim, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                      {a.duration > 0 ? `${a.duration}ms` : fmt(a.startTime)}
                    </span>
                    {/* Playhead position indicator */}
                    {(isActive || selectedAction === a) && playhead >= a.startTime && (() => {
                      const end = a.endTime || a.startTime;
                      const duration = end - a.startTime;
                      const progress = duration > 0 ? Math.min(1, Math.max(0, (playhead - a.startTime) / duration)) : (playhead >= a.startTime ? 1 : 0);
                      return (
                        <div style={{
                          position: "absolute", bottom: 0, left: 0, right: 0, height: 2,
                          background: V.border, borderRadius: 1, overflow: "hidden",
                        }}>
                          <div style={{
                            width: `${progress * 100}%`, height: "100%",
                            background: c, borderRadius: 1,
                          }} />
                        </div>
                      );
                    })()}
                  </div>
                );
              });
            })()}

            {/* Network panel */}
            {activePanel === "network" && traceData.network.map((n, i) => {
              const isActive = playhead >= n.startTime && playhead <= (n.endTime || n.startTime) + 200;
              const isPast = playhead > (n.endTime || n.startTime) + 200;
              const c = statusColor(n.status);
              return (
                <div key={i} ref={isActive ? (el) => el?.scrollIntoView?.({ block: "center", behavior: "smooth" }) : undefined} onClick={() => setPlayhead(n.startTime)} style={{
                  display: "flex", alignItems: "center", gap: 5, padding: "4px 6px", borderRadius: 5, marginBottom: 1, cursor: "pointer",
                  background: isActive ? `${c}15` : "transparent",
                  border: isActive ? `1px solid ${c}30` : "1px solid transparent",
                  opacity: isPast ? 0.4 : 1,
                  transition: "opacity 0.15s, background 0.15s",
                }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: isActive ? c : statusColor(n.status), minWidth: 22 }}>{n.status || "—"}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: V.textDim, minWidth: 26 }}>{n.method}</span>
                  <div style={{ flex: 1, fontSize: 13, color: isActive ? V.text : V.textMid, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortUrl(n.url)}</div>
                  <span style={{ fontSize: 12, color: V.textDim }}>{n.duration > 0 ? `${n.duration}ms` : ""}</span>
                </div>
              );
            })}

            {/* Console panel */}
            {activePanel === "console" && traceData.console.map((c, i) => {
              const nextTime = traceData.console[i + 1]?.time ?? (traceData.duration || Infinity);
              const isActive = playhead >= c.time && playhead < nextTime;
              const isPast = playhead >= nextTime;
              const color = levelColors[c.type] || V.textMid;
              return (
                <div key={i} ref={isActive ? (el) => el?.scrollIntoView?.({ block: "center", behavior: "smooth" }) : undefined} onClick={() => setPlayhead(c.time)} style={{
                  display: "flex", alignItems: "flex-start", gap: 5, padding: "4px 6px", borderRadius: 5, marginBottom: 1, cursor: "pointer",
                  background: isActive ? `${color}15` : "transparent",
                  border: isActive ? `1px solid ${color}30` : "1px solid transparent",
                  opacity: isPast ? 0.4 : 1,
                  transition: "opacity 0.15s, background 0.15s",
                }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", minWidth: 26, paddingTop: 1 }}>{c.type}</span>
                  <div style={{ fontSize: 13, color: isActive ? V.text : V.textMid, flex: 1, wordBreak: "break-all" }}>{c.text}</div>
                  <span style={{ fontSize: 12, color: V.textDim, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{fmt(c.time)}</span>
                </div>
              );
            })}

            {/* Info panel */}
            {activePanel === "files" && (
              <div style={{ padding: 6, fontSize: 13 }}>
                {/* Trace metadata */}
                {traceData.contextOptions && (() => {
                  const ctx = traceData.contextOptions;
                  const opts = ctx.options || {};
                  const vp = opts.viewport;
                  const metaRows = [
                    ctx.title && ["Title", ctx.title],
                    ctx.browserName && ["Browser", ctx.browserName],
                    ctx.platform && ["Platform", ctx.platform],
                    vp && ["Viewport", `${vp.width}×${vp.height}`],
                    opts.deviceScaleFactor && ["Scale", `${opts.deviceScaleFactor}x`],
                    opts.isMobile != null && ["Mobile", opts.isMobile ? "Yes" : "No"],
                    opts.hasTouch != null && ["Touch", opts.hasTouch ? "Yes" : "No"],
                    opts.locale && ["Locale", opts.locale],
                    opts.timezoneId && ["Timezone", opts.timezoneId],
                    opts.userAgent && ["User Agent", opts.userAgent],
                  ].filter(Boolean);
                  return metaRows.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: V.orange, textTransform: "uppercase", marginBottom: 6, letterSpacing: "0.04em" }}>Trace Info</div>
                      {metaRows.map(([label, value], i) => (
                        <div key={i} style={{ display: "flex", gap: 8, padding: "3px 0", borderBottom: `1px solid ${V.border}30` }}>
                          <span style={{ fontSize: 12, color: V.textDim, minWidth: 70, flexShrink: 0 }}>{label}</span>
                          <span style={{ fontSize: 12, color: V.textMid, wordBreak: "break-all" }}>{value}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Duration & stats */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: V.orange, textTransform: "uppercase", marginBottom: 6, letterSpacing: "0.04em" }}>Stats</div>
                  {[
                    ["Duration", `${(traceData.duration / 1000).toFixed(2)}s`],
                    ["Actions", `${traceData.actions.length}`],
                    ["Groups", `${(traceData.groups || []).length}`],
                    ["Network", `${traceData.network.length} requests`],
                    ["Console", `${traceData.console.length} logs`],
                    ["Screenshots", `${traceData.screenshots.filter(s => s.url).length} frames`],
                    ["Events", `${traceData.eventCount}`],
                  ].map(([label, value], i) => (
                    <div key={i} style={{ display: "flex", gap: 8, padding: "3px 0", borderBottom: `1px solid ${V.border}30` }}>
                      <span style={{ fontSize: 12, color: V.textDim, minWidth: 70, flexShrink: 0 }}>{label}</span>
                      <span style={{ fontSize: 12, color: V.textMid }}>{value}</span>
                    </div>
                  ))}
                </div>

                {/* File list */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: V.orange, textTransform: "uppercase", marginBottom: 6, letterSpacing: "0.04em" }}>Files ({fileList.length})</div>
                  {fileList.map((f, i) => (
                    <div key={i} style={{ color: V.textMid, padding: "2px 0", fontFamily: "monospace", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Action detail */}
          {selectedAction && activePanel === "actions" && (<>
            {/* Detail divider with centered chevron */}
            <div
              onMouseDown={(e) => { if (e.target.dataset.chevron || !showDetail) return; e.preventDefault(); detailDrag.current = true; detailDragStart.current = { y: e.clientY, h: detailH }; document.body.style.cursor = "row-resize"; }}
              onTouchStart={(e) => { if (e.target.dataset.chevron || !showDetail) return; const t = e.touches[0]; detailDrag.current = true; detailDragStart.current = { y: t.clientY, h: detailH }; }}
              style={{ height: mobile ? 24 : 9, flexShrink: 0, cursor: showDetail ? "row-resize" : "default", background: "transparent", position: "relative", zIndex: 20, display: "flex", alignItems: "center", justifyContent: "center", touchAction: "none" }}
            >
              <div style={{ position: "absolute", top: mobile ? 11 : 4, left: 0, right: 0, height: 1, background: V.border, transition: "background 0.15s" }}
                onMouseEnter={(e) => e.currentTarget.style.background = V.orange}
                onMouseLeave={(e) => e.currentTarget.style.background = V.border}
              />
              <div data-chevron="1" onClick={() => setShowDetail(d => !d)} style={{
                position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                width: 28, height: 16, borderRadius: 4, background: V.bgCard, border: `1px solid ${V.border}`,
                display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                fontSize: 13, color: V.textDim, zIndex: 21, transition: "color 0.15s, border-color 0.15s",
              }}
                onMouseEnter={(e) => { e.currentTarget.style.color = V.orange; e.currentTarget.style.borderColor = V.orange; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = V.textDim; e.currentTarget.style.borderColor = V.border; }}
              >{showDetail ? "▾" : "▴"}</div>
            </div>
            {showDetail && (
              <div style={{ height: detailH, padding: "6px 8px 8px", overflowY: "auto", flexShrink: 0, background: V.bg, userSelect: "text" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: actionColor(selectedAction.apiName) }}>{selectedAction.apiName}</div>
                  <span onClick={() => setMaskSensitive(m => !m)} style={{ fontSize: 11, color: maskSensitive ? V.textDim : V.orange, cursor: "pointer", padding: "1px 6px", borderRadius: 4, border: `1px solid ${maskSensitive ? V.border : V.orange}40` }}>
                    {maskSensitive ? "🔒 Masked" : "🔓 Visible"}
                  </span>
                </div>
                {selectedAction.error && (
                  <div style={{ fontSize: 13, color: "#ef4444", background: dark ? "#450a0a80" : "#fef2f240", padding: "4px 6px", borderRadius: 4, marginBottom: 4 }}>
                    {typeof selectedAction.error === "string" ? selectedAction.error : selectedAction.error?.message || JSON.stringify(selectedAction.error)}
                  </div>
                )}
                <pre style={{ fontSize: 12, color: V.textMid, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                  {(() => {
                    const ps = selectedAction.params;
                    if (!maskSensitive || !isSensitiveField(ps?.selector)) return JSON.stringify(ps, null, 2);
                    const masked = { ...ps };
                    if (masked.value) masked.value = "••••••";
                    return JSON.stringify(masked, null, 2);
                  })()}
                </pre>
              </div>
            )}
          </>)}
        </div>
        </>) : (
          /* Collapsed side panel — expand chevron */
          layoutMode === "main" ? (
          <div onClick={() => setShowSide(true)} style={{
            width: 20, flexShrink: 0, background: V.bgPanel, borderLeft: `1px solid ${V.border}`,
            display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
            transition: "background 0.15s",
          }}
            onMouseEnter={(e) => e.currentTarget.style.background = V.bgCard}
            onMouseLeave={(e) => e.currentTarget.style.background = V.bgPanel}
          >
            <span style={{ fontSize: 13, color: V.textDim }}>◂</span>
          </div>
          ) : layoutMode === "stacked" && (
          <div onClick={() => setShowSide(true)} style={{
            height: 20, flexShrink: 0, background: V.bgPanel, borderTop: `1px solid ${V.border}`,
            display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
            transition: "background 0.15s",
          }}
            onMouseEnter={(e) => e.currentTarget.style.background = V.bgCard}
            onMouseLeave={(e) => e.currentTarget.style.background = V.bgPanel}
          >
            <span style={{ fontSize: 13, color: V.textDim }}>▴</span>
          </div>
          )
        )}
      </div>

      {/* ─── Timeline ──────────────────────────────────────────── */}
      {showTimeline ? (<>
        {/* Resize handle with collapse chevron */}
        <div
          onMouseDown={(e) => { if (e.target.dataset.chevron) return; e.preventDefault(); timelineDrag.current = true; document.body.style.cursor = "row-resize"; }}
          onTouchStart={(e) => { if (e.target.dataset.chevron) return; timelineDrag.current = true; }}
          style={{ height: mobile ? 24 : 9, flexShrink: 0, cursor: "row-resize", background: "transparent", position: "relative", zIndex: 20, display: "flex", alignItems: "center", justifyContent: "center", touchAction: "none" }}
        >
          <div style={{ position: "absolute", top: mobile ? 11 : 4, left: 0, right: 0, height: 1, background: V.border, transition: "background 0.15s" }}
            onMouseEnter={(e) => e.currentTarget.style.background = V.orange}
            onMouseLeave={(e) => e.currentTarget.style.background = V.border}
          />
          <div data-chevron="1" onClick={() => setShowTimeline(false)} style={{
            position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            width: 28, height: 16, borderRadius: 4, background: V.bgCard, border: `1px solid ${V.border}`,
            display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
            fontSize: 13, color: V.textDim, zIndex: 21, transition: "color 0.15s, border-color 0.15s",
          }}
            onMouseEnter={(e) => { e.currentTarget.style.color = V.orange; e.currentTarget.style.borderColor = V.orange; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = V.textDim; e.currentTarget.style.borderColor = V.border; }}
          >▾</div>
        </div>
        {/* Filmstrip — hidden on mobile */}
        {!mobile && !compact && traceData.screenshots.filter(s => s.url).length > 0 && (
          <div ref={filmstripRef} className="hide-scrollbar" onScroll={() => setHoveredThumb(null)} style={{ height: 56, background: V.bgPanel, borderTop: `1px solid ${V.border}`, display: "flex", alignItems: "center", padding: "0 8px", gap: 4, overflowX: "auto", flexShrink: 0, position: "relative" }}>
            {traceData.screenshots.filter(s => s.url).map((s, i) => {
              const active = currentScreenshot === s;
              return (
              <div key={i} ref={active ? (el) => {
                if (el && isPlaying && filmstripRef.current) {
                  const container = filmstripRef.current;
                  const left = el.offsetLeft - container.offsetLeft - container.clientWidth / 2 + el.offsetWidth / 2;
                  container.scrollTo({ left, behavior: "smooth" });
                }
              } : undefined} onClick={() => setPlayhead(s.time)}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setHoveredThumb({ url: s.url, x: rect.left + rect.width / 2, y: rect.top });
                }}
                onMouseLeave={() => setHoveredThumb(null)}
                style={{
                  width: 64, height: 40, flexShrink: 0, borderRadius: 4, overflow: "hidden",
                  border: active ? `3px solid ${V.orange}` : `1px solid ${V.border}`,
                  cursor: "pointer", boxShadow: active ? `0 0 16px ${V.orange}60` : "none",
                }}>
                <img src={s.url} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" />
              </div>
              );
            })}

            {/* Hover preview */}
            {hoveredThumb && (() => {
              const previewW = 320;
              const centerX = hoveredThumb.x;
              const left = Math.max(8, Math.min(centerX - previewW / 2, window.innerWidth - previewW - 8));
              return (
                <div style={{
                  position: "fixed", left, top: hoveredThumb.y,
                  transform: "translateY(calc(-100% - 12px))",
                  width: previewW, borderRadius: 8, overflow: "hidden",
                  border: `2px solid ${V.orange}`, boxShadow: `0 8px 30px rgba(0,0,0,0.5)`,
                  pointerEvents: "none", zIndex: 100,
                }}>
                  <img src={hoveredThumb.url} style={{ width: "100%", display: "block" }} alt="" />
                </div>
              );
            })()}
          </div>
        )}
        <div style={{ height: timelineH, flexShrink: 0, background: V.bg, overflow: "hidden" }}>
        <div
          ref={scrollRef}
          style={{ overflowX: "auto", overflowY: "auto", cursor: "crosshair", position: "relative", height: "100%", touchAction: "pan-y" }}
          onMouseDown={(e) => { dragging.current = true; handleScrub(e); }}
          onTouchStart={(e) => { dragging.current = true; const t = e.touches[0]; handleScrub({ clientX: t.clientX, clientY: t.clientY, currentTarget: e.currentTarget }); }}
        >
          <div style={{ width: `${100 * zoom}%`, minWidth: "100%", position: "relative" }}>
            {/* Proportional lane heights based on panel size */}
            {(() => {
              const base = 94; // sum: 14+16+24+20+16 (ruler+groups+actions+network+console)
              const s = timelineH / base;
              const rulerH = Math.round(14 * s);
              const groupsH = Math.round(16 * s);
              const actionsH = Math.round(24 * s);
              const networkH = Math.round(20 * s);
              const consoleH = Math.round(16 * s);
              const actionBarPad = Math.max(2, Math.round(3 * s));
              const actionBarH = actionsH - actionBarPad * 2;
              const netBarPad = Math.max(1, Math.round(2 * s));
              const netBarH = networkH - netBarPad * 2;
              const dotSize = Math.max(4, Math.round(5 * s));
              const dotErrSize = Math.max(5, Math.round(8 * s));
              const fontSize = Math.max(6, Math.min(11, Math.round(7 * s)));
              const rulerFontSize = Math.max(6, Math.min(10, Math.round(8 * s)));
              const labelW = 56;
              const labelStyle = { position: "absolute", left: 0, top: 0, bottom: 0, width: labelW, zIndex: 5, display: "flex", alignItems: "center", paddingLeft: 6, fontSize: Math.max(7, Math.min(10, Math.round(8 * s))), fontWeight: 600, pointerEvents: "none", background: V.bg, borderRight: `1px solid ${V.border}20` };
              const laneContentStyle = { position: "absolute", left: labelW, right: 0, top: 0, bottom: 0 };
              const groupColors = [V.purple, V.grape, V.magenta, V.orange, V.amber];
              return (<>

            {/* Ruler */}
            <div style={{ height: rulerH, position: "relative", borderBottom: `1px solid ${V.border}` }}>
              <div style={{ ...labelStyle, color: V.textDim, fontSize: Math.max(6, Math.min(9, Math.round(7 * s))) }}>Time</div>
              <div style={laneContentStyle}>
                {ticks.map(t => (
                  <div key={t} style={{ position: "absolute", left: `${(t / D) * 100}%`, top: 0, height: "100%", borderLeft: `1px solid ${V.border}` }}>
                    <span style={{ position: "absolute", top: Math.round(2 * s), left: 4, fontSize: rulerFontSize, color: V.textDim, fontVariantNumeric: "tabular-nums" }}>{fmt(t)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Groups lane */}
            <div style={{ height: groupsH, position: "relative", borderBottom: `1px solid ${V.border}` }}>
              <div style={{ ...labelStyle, color: V.purple, fontSize: Math.max(6, Math.min(9, Math.round(7 * s))) }}>Groups</div>
              <div style={{ ...laneContentStyle, overflow: "hidden" }}>
                {(traceData.groups || []).map((g, i) => {
                  const left = (g.startTime / D) * 100;
                  const width = Math.max(((g.endTime - g.startTime) / D) * 100, 0.3);
                  const isActive = playhead >= g.startTime && playhead <= g.endTime;
                  const gc = groupColors[i % groupColors.length];
                  const barH = groupsH - 4;
                  return (
                    <div key={`gl-${i}`} style={{
                      position: "absolute", left: `${left}%`, top: 2, width: `${width}%`, height: barH,
                      background: isActive ? `${gc}25` : `${gc}12`,
                      borderLeft: `2px solid ${gc}${isActive ? "80" : "40"}`,
                      borderRadius: "0 3px 3px 0",
                      display: "flex", alignItems: "center", padding: "0 4px", overflow: "hidden",
                    }}>
                      <span style={{ fontSize: Math.max(6, Math.min(9, Math.round(7 * s))), fontWeight: 600, color: `${gc}${isActive ? "dd" : "80"}`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.title}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Actions lane */}
            <div style={{ height: actionsH, position: "relative", borderBottom: `1px solid ${V.border}` }}>
              <div style={{ ...labelStyle, color: V.orange }}>Actions</div>
              <div style={laneContentStyle}>
                {filteredActions.map((a, i) => {
                  const left = (a.startTime / D) * 100;
                  const w = Math.max(((a.endTime - a.startTime) / D) * 100, 0.2);
                  const c = actionColor(a.apiName);
                  const isSelected = selectedAction === a;
                  return (
                    <div key={i} onClick={() => { setPlayhead(a.endTime || a.startTime); setSelectedAction(a); }} style={{
                      position: "absolute", left: `${left}%`, top: actionBarPad,
                      width: `max(${w}%, 16px)`, height: actionBarH,
                      background: a.error ? "#ef444430" : isSelected ? `${c}40` : `${c}25`, border: `1px solid ${a.error ? "#ef4444" : isSelected ? c : `${c}40`}`, borderRadius: Math.round(3 * Math.min(s, 1.5)),
                      display: "flex", alignItems: "center", padding: "0 3px", overflow: "hidden",
                      cursor: "pointer", transition: "background 0.15s",
                    }}>
                      <span style={{ fontSize, fontWeight: 600, color: a.error ? "#ef4444" : c, whiteSpace: "nowrap" }}>{a.apiName?.split(".").pop()}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Network lane */}
            <div style={{ height: networkH, position: "relative", borderBottom: `1px solid ${V.border}` }}>
              <div style={{ ...labelStyle, color: "#22c55e" }}>Network</div>
              <div style={laneContentStyle}>
                {traceData.network.map((n, i) => {
                  const left = (n.startTime / D) * 100;
                  const w = Math.max(((n.endTime - n.startTime) / D) * 100, 0.1);
                  const c = statusColor(n.status);
                  return (
                    <div key={i} style={{
                      position: "absolute", left: `${left}%`, top: netBarPad,
                      width: `max(${w}%, 3px)`, height: netBarH,
                      background: `${c}30`, borderLeft: `2px solid ${c}`, borderRadius: "0 2px 2px 0",
                    }} />
                  );
                })}
              </div>
            </div>

            {/* Console dots lane */}
            <div style={{ height: consoleH, position: "relative" }}>
              <div style={{ ...labelStyle, color: V.sunset }}>Console</div>
              <div style={laneContentStyle}>
                {traceData.console.map((c, i) => {
                  const left = (c.time / D) * 100;
                  const color = levelColors[c.type] || V.textDim;
                  return (
                    <div key={i} style={{
                      position: "absolute", left: `${left}%`, top: "50%", transform: "translate(-50%, -50%)",
                      width: c.type === "error" ? dotErrSize : dotSize, height: c.type === "error" ? dotErrSize : dotSize,
                      borderRadius: c.type === "error" ? 2 : "50%", background: color,
                      boxShadow: c.type === "error" ? `0 0 6px ${color}60` : "none",
                    }} />
                  );
                })}
              </div>
            </div>

            {/* Playhead — offset to match content area */}
            <div style={{ position: "absolute", left: labelW, right: 0, top: 0, bottom: 0, pointerEvents: "none", zIndex: 50 }}>
              <div style={{
                position: "absolute", left: `${(playhead / D) * 100}%`, top: 0, bottom: 0,
                width: 2, background: V.orange,
                boxShadow: `0 0 12px ${V.orange}40, 0 0 4px ${V.orange}60`,
              }}>
                <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 10, height: 12, background: V.orange, borderRadius: "0 0 3px 3px" }} />
              </div>
            </div>
              </>);
            })()}
          </div>
        </div>
      </div>
      </>) : (
        /* Collapsed timeline — expand chevron */
        <div onClick={() => setShowTimeline(true)} style={{
          height: 20, flexShrink: 0, background: V.bgPanel, borderTop: `1px solid ${V.border}`,
          display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
          transition: "background 0.15s",
        }}
          onMouseEnter={(e) => e.currentTarget.style.background = V.bgCard}
          onMouseLeave={(e) => e.currentTarget.style.background = V.bgPanel}
        >
          <span style={{ fontSize: 13, color: V.textDim }}>▴</span>
        </div>
      )}

      {/* ─── Status bar ────────────────────────────────────────── */}
      {!compact && !mobile && showTimeline && <div ref={footerRef} style={{ height: 24, background: V.bg, borderTop: `1px solid ${V.border}`, display: "flex", alignItems: "center", padding: "0 14px", gap: 14, fontSize: 13, color: V.textDim, flexShrink: 0 }}>
        {!footerNarrow && <>
          <span><span style={{ color: traceData.actions.some(a => a.error) ? "#ef4444" : "#22c55e" }}>●</span> {traceData.actions.some(a => a.error) ? "Has errors" : "OK"}</span>
          <span>{filteredActions.length}{actionFilter !== "all" ? `/${traceData.actions.length}` : ""} actions</span>
          {(traceData.groups||[]).length > 0 && <span>{traceData.groups.length} groups</span>}
          <span>{traceData.network.length} requests</span>
          <span>{traceData.screenshots.filter(s => s.url).length} frames</span>
          <div style={{ flex: 1 }} />
          <span>{traceData.actions.filter(a => a.error).length} action error{traceData.actions.filter(a => a.error).length === 1 ? "" : "s"}</span>
          <span>{traceData.network.filter(n => n.status >= 400).length} HTTP error{traceData.network.filter(n => n.status >= 400).length === 1 ? "" : "s"}</span>
          <span>{traceData.console.filter(c => c.type === "error").length} console error{traceData.console.filter(c => c.type === "error").length === 1 ? "" : "s"}</span>
          <span>{traceData.fileCount} files</span>
          <div style={{ width: 1, height: 12, background: V.border }} />
        </>}
        {footerNarrow && <div style={{ flex: 1 }} />}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 11 }}>🔍</span>
          <input type="range" min={0.5} max={4} step={0.1} value={zoom} onChange={(e) => setZoom(parseFloat(e.target.value))} style={{ width: 60, accentColor: V.orange, height: 2, cursor: "pointer", outline: "none" }} />
        </div>
      </div>}

      {/* Help overlay */}
      {showHelp && (
        <div onClick={() => setShowHelp(false)} style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: V.bgCard, border: `1px solid ${V.border}`, borderRadius: 12,
            padding: "28px 36px", maxWidth: compact ? 720 : 520, width: "90%", color: V.text,
            boxShadow: "0 20px 60px rgba(0,0,0,0.4)", maxHeight: "85vh", overflowY: "auto",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: V.orange }}>Keyboard Shortcuts</span>
              <span onClick={() => setShowHelp(false)} style={{ cursor: "pointer", color: V.textDim, fontSize: 20, lineHeight: 1 }}>✕</span>
            </div>
            <div style={{ columns: compact ? 2 : 1, columnGap: 32 }}>
            {[
              ["Playback", [
                ["Space", "Play / Pause"],
                ["← ↑", "Previous action start/end"],
                ["→ ↓", "Next action start/end"],
                ["Home", "Jump to start"],
                ["End", "Jump to end"],
                ["0 – 9", "Jump to 0% – 90%"],
              ]],
              ["View", [
                ["C", "Toggle control panel"],
                ["T", "Toggle timeline"],
                ["I", "Toggle inspector"],
                ["H", "Toggle element highlight"],
                ["V", "Toggle stacked/default layout"],
                ["D / L", "Toggle dark / light mode"],
                ["?", "Show this help"],
                ["Esc", "Close this help"],
              ]],
              ["URL Parameters", [
                ["?c=v / h", "Control panel visible / hidden"],
                ["?t=v / h", "Timeline visible / hidden"],
                ["?i=v / h", "Inspector visible / hidden"],
                ["?at=5000", "Jump to 5000ms"],
                ["?at=5s", "Jump to 5 seconds"],
                ["?at=1:23.45", "Jump to 1m 23.45s"],
              ]],
              ["Mobile", [
                ["Swipe ←", "Previous action"],
                ["Swipe →", "Next action"],
                ["◀ ▶", "Step buttons in toolbar"],
              ]],
            ].map(([section, shortcuts]) => (
              <div key={section} style={{ marginBottom: 16, breakInside: "avoid" }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: V.textDim, marginBottom: 8 }}>{section}</div>
                {shortcuts.map(([key, desc]) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", padding: "4px 0", gap: 12 }}>
                    <kbd style={{
                      display: "inline-block", minWidth: 48, textAlign: "center",
                      padding: "3px 8px", borderRadius: 5, fontSize: 12, fontFamily: "inherit", fontWeight: 600,
                      background: V.bg, border: `1px solid ${V.border}`, color: V.textMid,
                    }}>{key}</kbd>
                    <span style={{ fontSize: 13, color: V.textMid }}>{desc}</span>
                  </div>
                ))}
              </div>
            ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default RecordStudio;
