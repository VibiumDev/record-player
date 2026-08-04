import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import CompareStudio from "../components/CompareStudio";
import RecordStudio from "../components/RecordStudio";

async function vibiumFile(events: unknown[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("trace.trace", events.map((event) => JSON.stringify(event)).join("\n"));
  return zip.generateAsync({ type: "uint8array" });
}

async function playwrightFile(events: unknown[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("trace.trace", events.map((event) => JSON.stringify(event)).join("\n"));
  zip.file("resources/a.jpeg", new Uint8Array([1]));
  zip.file("resources/b.jpeg", new Uint8Array([2]));
  return zip.generateAsync({ type: "uint8array" });
}

describe("RecordStudio console UI", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/?i=v&t=h&c=h");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
    localStorage.clear();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("opens console error details after clicking the Log tab and an ERROR row", async () => {
    const traceLine = JSON.stringify({
      type: "event",
      method: "log.entryAdded",
      params: {
        timestamp: 100,
        level: "error",
        type: "javascript",
        text: "Uncaught TypeError: Cannot read properties of undefined",
        stackTrace: {
          callFrames: [
            {
              functionName: "renderApp",
              url: "http://localhost:5173/src/App.js",
              lineNumber: 12,
              columnNumber: 5,
            },
          ],
        },
      },
    });

    render(<RecordStudio initialFile={await vibiumFile([JSON.parse(traceLine)])} hideGlobalChrome />);

    fireEvent.click(await screen.findByRole("button", { name: "Log (1)" }));
    fireEvent.click(screen.getByText("error"));

    await waitFor(() => {
      expect(screen.getByText(/Stack:/)).toBeInTheDocument();
      expect(screen.getByText(/at renderApp \(http:\/\/localhost:5173\/src\/App.js:12:5\)/)).toBeInTheDocument();
    });
  });

  it("keeps an interleaved Playwright studio view on one page", async () => {
    window.history.pushState({}, "", "/?at=6&i=v&t=v&c=h");
    const recording = await playwrightFile([
      { type: "context-options", version: 8, origin: "library", contextId: "ctx-a", options: { viewport: { width: 320, height: 200 }, deviceScaleFactor: 1 } },
      { type: "before", callId: "a", title: "page.click", startTime: 0, contextId: "ctx-a", pageId: "page-a" },
      { type: "after", callId: "a", endTime: 1, contextId: "ctx-a", pageId: "page-a" },
      { type: "screencast-frame", timestamp: 0, sha1: "a.jpeg", contextId: "ctx-a", pageId: "page-a", width: 320, height: 200 },
      { type: "console", time: 6, contextId: "ctx-b", pageId: "page-b", messageType: "error", text: "page b error" },
      { type: "before", callId: "b", title: "page.click", startTime: 10, contextId: "ctx-b", pageId: "page-b" },
      { type: "input", callId: "b", point: { x: 20, y: 20 }, contextId: "ctx-b", pageId: "page-b" },
      { type: "after", callId: "b", endTime: 12, contextId: "ctx-b", pageId: "page-b" },
      { type: "screencast-frame", timestamp: 20, sha1: "b.jpeg", contextId: "ctx-b", pageId: "page-b", width: 320, height: 200 },
    ]);
    const { container } = render(<RecordStudio initialFile={recording} />);

    fireEvent.click(await screen.findByRole("button", { name: "Log (1)" }));
    expect(screen.getByText("page b error · library:page-b")).toBeInTheDocument();
    expect(screen.getByLabelText("Recording page")).toHaveValue("library:page-b");
    expect(screen.queryByAltText("trace screenshot")).not.toBeInTheDocument();
    expect(container.querySelectorAll('img[src="data:image/jpeg;base64,Ag=="]')).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("Recording page"), { target: { value: "library:page-a" } });
    expect(screen.getByAltText("trace screenshot")).toHaveAttribute("src", "data:image/jpeg;base64,AQ==");
    expect(container.querySelectorAll('img[src="data:image/jpeg;base64,Ag=="]')).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Recording page"), { target: { value: "library:page-b" } });
    expect(screen.queryByAltText("trace screenshot")).not.toBeInTheDocument();
    const bFilmstrip = container.querySelector('img[src="data:image/jpeg;base64,Ag=="]');
    expect(bFilmstrip).not.toBeNull();
    fireEvent.click(bFilmstrip!.parentElement!);
    expect(screen.getByAltText("trace screenshot")).toHaveAttribute("src", "data:image/jpeg;base64,Ag==");
  });

  it("shows a toggle for skip-idle playback", async () => {
    window.history.pushState({}, "", "/?i=h&t=h&c=v");
    const traceLines = [
      {
        type: "before",
        title: "Page.navigate",
        callId: "call@1",
        startTime: 0,
        class: "Page",
        method: "vibium:page.navigate",
        params: { url: "http://localhost:5173" },
      },
      { type: "after", callId: "call@1", endTime: 100 },
      {
        type: "before",
        title: "Page.wait",
        callId: "call@2",
        startTime: 5000,
        class: "Page",
        method: "vibium:page.wait",
        params: { text: "Ready" },
      },
      { type: "after", callId: "call@2", endTime: 5100 },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n");

    render(<RecordStudio initialFile={await vibiumFile(traceLines.split("\n").map(JSON.parse))} hideGlobalChrome />);

    const skipIdle = await screen.findByRole("button", { name: "Skip idle" });
    expect(skipIdle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(skipIdle);

    expect(skipIdle).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the skip-idle toggle on mobile", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    window.history.pushState({}, "", "/?i=h&t=h&c=v");
    const traceLines = [
      {
        type: "before",
        title: "Page.navigate",
        callId: "call@1",
        startTime: 0,
        class: "Page",
        method: "vibium:page.navigate",
        params: { url: "http://localhost:5173" },
      },
      { type: "after", callId: "call@1", endTime: 100 },
      {
        type: "before",
        title: "Page.wait",
        callId: "call@2",
        startTime: 5000,
        class: "Page",
        method: "vibium:page.wait",
        params: { text: "Ready" },
      },
      { type: "after", callId: "call@2", endTime: 5100 },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n");

    render(<RecordStudio initialFile={await vibiumFile(traceLines.split("\n").map(JSON.parse))} hideGlobalChrome />);

    const skipIdle = await screen.findByRole("button", { name: "Skip idle" });
    expect(skipIdle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(skipIdle);

    expect(skipIdle).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a shared skip-idle toggle in compare mode", async () => {
    const traceLines = [
      {
        type: "before",
        title: "Page.navigate",
        callId: "call@1",
        startTime: 0,
        class: "Page",
        method: "vibium:page.navigate",
        params: { url: "http://localhost:5173" },
      },
      { type: "after", callId: "call@1", endTime: 100 },
      {
        type: "before",
        title: "Page.wait",
        callId: "call@2",
        startTime: 5000,
        class: "Page",
        method: "vibium:page.wait",
        params: { text: "Ready" },
      },
      { type: "after", callId: "call@2", endTime: 5100 },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n");

    const { container } = render(<CompareStudio />);
    const inputs = Array.from(container.querySelectorAll("input[type='file']"));
    expect(inputs).toHaveLength(2);

    const fixture = await vibiumFile(traceLines.split("\n").map(JSON.parse));
    fireEvent.change(inputs[0], { target: { files: [fixture] } });
    fireEvent.change(inputs[1], { target: { files: [fixture] } });

    const skipIdle = await screen.findByRole("button", { name: "Skip idle" });
    expect(skipIdle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(skipIdle);

    expect(skipIdle).toHaveAttribute("aria-pressed", "true");
  });

  it("detects Twee by archive content, uses the reusable player, and opens a replacement", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    const tweeFile = async (name: string, command: string) => {
      const zip = new JSZip();
      zip.file("manifest.json", JSON.stringify({ version: 1, command: [command], cols: 80, rows: 24 }));
      zip.file("events.jsonl", `${JSON.stringify({ type: "output", t_ms: 0, bytes_b64: "b2s=" })}\n`);
      const bytes = await zip.generateAsync({ type: "uint8array" });
      Object.defineProperty(bytes, "name", { value: name });
      return bytes;
    };

    const first = await tweeFile("first.twee", "first-command");
    render(<RecordStudio initialFile={first} />);

    expect(await screen.findByText(/first\.twee/)).toBeInTheDocument();
    expect(screen.queryByText("Twee")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Recording information" }));
    expect(screen.getByRole("dialog", { name: "Recording information" })).toHaveTextContent("twee");
    expect(screen.queryByRole("button", { name: /Log \(/ })).not.toBeInTheDocument();

    const second = await tweeFile("second.zip", "second-command");
    fireEvent.change(screen.getByLabelText("Open another recording"), { target: { files: [second] } });

    expect(await screen.findByText(/second\.zip/)).toBeInTheDocument();
    expect(screen.getByText(/second-command/)).toBeInTheDocument();
  });

  it("surfaces malformed Twee content even when the file is named .zip", async () => {
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({ version: 1, command: ["broken"], cols: 80, rows: 24 }));
    const malformed = await zip.generateAsync({ type: "uint8array" });
    Object.defineProperty(malformed, "name", { value: "malformed.zip" });

    render(<RecordStudio initialFile={malformed} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("missing events.jsonl");
    expect(screen.queryByText("Trace loaded")).not.toBeInTheDocument();
  });
});
