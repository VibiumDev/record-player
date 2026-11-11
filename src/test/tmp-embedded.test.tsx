// @ts-nocheck -- throwaway inspection
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import RecordStudio from "../components/RecordStudio";

async function vibiumFile(events: unknown[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("trace.trace", events.map((e) => JSON.stringify(e)).join("\n"));
  return zip.generateAsync({ type: "uint8array" });
}

describe("embedded toolbar", () => {
  it("lists toolbar buttons when embedded", async () => {
    localStorage.clear();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
    });
    const file = await vibiumFile([
      { type: "before", title: "Page.navigate", callId: "c1", startTime: 0, class: "Page", method: "vibium:page.navigate", params: { url: "http://x" } },
      { type: "after", callId: "c1", endTime: 100 },
    ]);
    const { container } = render(<RecordStudio initialFile={file} hideGlobalChrome />);
    await screen.findByRole("button", { name: "Sound" });
    const names = Array.from(container.querySelectorAll("button")).map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim()).filter(Boolean);
    console.log("EMBEDDED_BUTTONS:", JSON.stringify(names));
    expect(names.length).toBeGreaterThan(0);
  });

  it("lists toolbar buttons when NOT embedded", async () => {
    localStorage.clear();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
    });
    const file = await vibiumFile([
      { type: "before", title: "Page.navigate", callId: "c1", startTime: 0, class: "Page", method: "vibium:page.navigate", params: { url: "http://x" } },
      { type: "after", callId: "c1", endTime: 100 },
    ]);
    const { container } = render(<RecordStudio initialFile={file} />);
    await screen.findByRole("button", { name: "Sound" });
    const names = Array.from(container.querySelectorAll("button")).map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim()).filter(Boolean);
    console.log("STANDALONE_BUTTONS:", JSON.stringify(names));
    expect(names.length).toBeGreaterThan(0);
  });
});
