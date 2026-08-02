import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import CompareStudio from "../components/CompareStudio";
import RecordStudio from "../components/RecordStudio";

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

    vi.stubGlobal("JSZip", {
      loadAsync: vi.fn(async () => ({
        files: {
          "trace.trace": {
            dir: false,
            async: vi.fn(async () => traceLine),
          },
        },
      })),
    });

    render(<RecordStudio initialFile={new Blob(["zip"])} hideGlobalChrome />);

    fireEvent.click(await screen.findByRole("button", { name: "Log (1)" }));
    fireEvent.click(screen.getByText("error"));

    await waitFor(() => {
      expect(screen.getByText(/Stack:/)).toBeInTheDocument();
      expect(screen.getByText(/at renderApp \(http:\/\/localhost:5173\/src\/App.js:12:5\)/)).toBeInTheDocument();
    });
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

    vi.stubGlobal("JSZip", {
      loadAsync: vi.fn(async () => ({
        files: {
          "trace.trace": {
            dir: false,
            async: vi.fn(async () => traceLines),
          },
        },
      })),
    });

    render(<RecordStudio initialFile={new Blob(["zip"])} hideGlobalChrome />);

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

    vi.stubGlobal("JSZip", {
      loadAsync: vi.fn(async () => ({
        files: {
          "trace.trace": {
            dir: false,
            async: vi.fn(async () => traceLines),
          },
        },
      })),
    });

    render(<RecordStudio initialFile={new Blob(["zip"])} hideGlobalChrome />);

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

    vi.stubGlobal("JSZip", {
      loadAsync: vi.fn(async () => ({
        files: {
          "trace.trace": {
            dir: false,
            async: vi.fn(async () => traceLines),
          },
        },
      })),
    });

    const { container } = render(<CompareStudio />);
    const inputs = Array.from(container.querySelectorAll("input[type='file']"));
    expect(inputs).toHaveLength(2);

    fireEvent.change(inputs[0], { target: { files: [new File(["zip"], "before.zip", { type: "application/zip" })] } });
    fireEvent.change(inputs[1], { target: { files: [new File(["zip"], "after.zip", { type: "application/zip" })] } });

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
    expect(screen.getByText("Twee")).toBeInTheDocument();
    expect(screen.getByText(/first-command/)).toBeInTheDocument();
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
