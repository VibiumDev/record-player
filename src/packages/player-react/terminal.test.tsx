import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TweeEvent, TweeRecording } from "../player-core";
import type { GhosttyTerminal } from "../ghostty-browser";
import { RecordPlayer } from "./index";
import { sanitizeGhosttyHTML, TerminalPresentation } from "./terminal";

const encoder = new TextEncoder();

class FakeTerminal implements GhosttyTerminal {
  screen = "";
  cols: number;
  rows: number;
  writes: string[] = [];
  resizes: Array<[number, number]> = [];
  resets: Array<[number, number]> = [];
  formats = 0;
  disposed = false;

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
  }

  write(data: Uint8Array) {
    const text = new TextDecoder().decode(data);
    this.writes.push(text);
    this.screen += text;
  }

  resize(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.resizes.push([cols, rows]);
  }

  reset(cols: number, rows: number) {
    this.screen = "";
    this.cols = cols;
    this.rows = rows;
    this.resets.push([cols, rows]);
  }

  formatHTML() {
    this.formats += 1;
    return `<pre>${this.screen.split("&").join("&amp;").split("<").join("&lt;")}</pre>`;
  }

  dispose() {
    this.disposed = true;
  }
}

function output(id: string, time: number, text: string): TweeEvent {
  return { id, time, type: "output", bytes: encoder.encode(text) };
}

function recording(name = "session.twee", events?: TweeEvent[], duration = 400): TweeRecording {
  const terminalEvents = events ?? [
    output("a", 0, "A"),
    { id: "input", time: 100, type: "input", bytes: encoder.encode("ignored"), inputKind: "text" },
    output("b", 200, "B"),
    { id: "resize", time: 250, type: "resize", cols: 100, rows: 30 },
    output("c", 300, "C"),
    { id: "exit", time: 400, type: "exit", code: 0 },
  ];
  return {
    version: 1,
    format: "twee",
    source: name,
    files: ["manifest.json", "events.jsonl"],
    metadata: { fileCount: 2, eventCount: terminalEvents.length },
    timeline: { startTime: 0, endTime: duration, duration, events: terminalEvents },
    presentation: { kind: "terminal", initialCols: 80, initialRows: 24 },
    manifest: { version: 1, command: ["sh", "-lc", "demo"], cols: 80, rows: 24 },
    terminalEvents,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TerminalPresentation playback", () => {
  it("uses Twee's packaged font stack and native default terminal colors", async () => {
    const terminal = new FakeTerminal(80, 24);
    render(
      <TerminalPresentation
        recording={recording()}
        currentTime={0}
        terminalFactory={async () => terminal}
      />,
    );

    const viewport = screen.getByLabelText("Terminal playback");
    expect(viewport).toHaveStyle({ background: "#000000", color: "#c8c8c8" });
    expect(viewport.style.fontFamily).toContain("Record Player JetBrains Mono");
    expect(viewport).toHaveStyle({ fontSize: "14px", lineHeight: "20px" });
    const fontRules = document.querySelector("style[data-record-player-terminal-fonts]");
    expect(fontRules).toHaveTextContent("Record Player Noto Sans Symbols 2");
    expect(fontRules).toHaveTextContent("NotoSansSymbols2-Regular.ttf");
    expect(await screen.findByText("A")).toBeInTheDocument();
  });

  it("changes fullscreen layout without recreating the terminal session", async () => {
    const terminal = new FakeTerminal(80, 24);
    const factory = vi.fn(async () => terminal);
    const value = recording();
    const { rerender } = render(
      <TerminalPresentation recording={value} currentTime={0} terminalFactory={factory} />,
    );
    await screen.findByText("A");
    rerender(<TerminalPresentation recording={value} currentTime={0} terminalFactory={factory} isFullscreen />);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(terminal.disposed).toBe(false);
    expect(screen.getByLabelText("Terminal playback")).toHaveStyle({ height: "100%", minHeight: "0" });
  });

  it("plays from start to end on the RecordPlayer clock and ignores input bytes", async () => {
    const terminal = new FakeTerminal(80, 24);
    const short = recording("play.twee", [
      output("a", 0, "A"),
      { id: "input", time: 15, type: "input", bytes: encoder.encode("NO") },
      output("b", 30, "B"),
    ], 30);

    render(<RecordPlayer recording={short} terminalFactory={async () => terminal} inspector="hidden" />);
    expect(await screen.findByText("A")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Play recording" }));

    expect(await screen.findByText("AB", {}, { timeout: 1000 })).toBeInTheDocument();
    expect(terminal.screen).toBe("AB");
    expect(terminal.writes).toEqual(["A", "B"]);
    const restart = await screen.findByRole("button", { name: "Replay recording" });

    fireEvent.click(restart);
    await waitFor(() => expect(terminal.resets).toEqual([[80, 24]]));
    await waitFor(() => expect(terminal.writes).toEqual(["A", "B", "A", "B"]));
    expect(await screen.findByRole("button", { name: "Replay recording" })).toBeInTheDocument();
  });

  it("pauses and continues without applying future output while paused", async () => {
    const terminal = new FakeTerminal(80, 24);
    const value = recording("pause.twee", [output("a", 0, "A"), output("b", 150, "B")], 150);

    render(<RecordPlayer recording={value} terminalFactory={async () => terminal} inspector="hidden" />);
    expect(await screen.findByText("A")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Play recording" }));
    fireEvent.click(screen.getByRole("button", { name: "Pause recording" }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(terminal.screen).toBe("A");

    fireEvent.click(screen.getByRole("button", { name: "Play recording" }));
    expect(await screen.findByText("AB", {}, { timeout: 1000 })).toBeInTheDocument();
  });

  it("keeps late semantic events visible after a dense output stream", async () => {
    const terminal = new FakeTerminal(80, 24);
    const events: TweeEvent[] = Array.from({ length: 300 }, (_, index) =>
      output(`output-${index}`, index, "."));
    events.push(
      { id: "late-input", time: 310, type: "input", bytes: encoder.encode("x") },
      { id: "late-resize", time: 320, type: "resize", cols: 100, rows: 30 },
      { id: "late-exit", time: 330, type: "exit", code: 0 },
    );

    render(
      <RecordPlayer
        recording={recording("dense.twee", events, 330)}
        terminalFactory={async () => terminal}
        inspector="hidden"
      />,
    );

    expect(await screen.findByTitle("input 310ms")).toBeInTheDocument();
    expect(screen.getByTitle("resize 320ms")).toBeInTheDocument();
    expect(screen.getByTitle("exit 330ms")).toBeInTheDocument();
  });

  it("shows valid mouse input on its recorded terminal cell, then clears it after a resize or 500ms", async () => {
    const terminal = new FakeTerminal(80, 24);
    const value = recording("mouse.twee", [
      output("start", 0, "A"),
      {
        id: "mouse", time: 100, type: "input", inputKind: "mouse", bytes: new Uint8Array(),
        mouse: { gesture: "click", x: 0, y: 0, button: "left", modifiers: [] },
      },
      { id: "resize", time: 150, type: "resize", cols: 100, rows: 30 },
    ], 700);
    const { rerender } = render(
      <TerminalPresentation recording={value} currentTime={0} terminalFactory={async () => terminal} />,
    );

    const viewport = screen.getByLabelText("Terminal playback");
    const grid = screen.getByTestId("terminal-grid");
    const scroll = screen.getByTestId("terminal-scroll-content");
    let gridRect = { left: 12, top: 12, width: 640, height: 480 };
    const rect = (left: number, top: number, width: number, height: number) => ({
      x: left, y: top, left, top, width, height,
      right: left + width, bottom: top + height,
      toJSON: () => ({}),
    }) as DOMRect;
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(rect(0, 0, 700, 520));
    vi.spyOn(grid, "getBoundingClientRect").mockImplementation(() => rect(
      gridRect.left, gridRect.top, gridRect.width, gridRect.height,
    ));

    rerender(<TerminalPresentation recording={value} currentTime={100} terminalFactory={async () => terminal} />);
    const annotation = await screen.findByTestId("mouse-annotation");
    expect(annotation).toHaveStyle({ left: "12px", top: "12px" });
    expect(annotation).toHaveAttribute("viewBox", "0 0 640 480");

    // The overlay is not inside the scrolling content, so it is explicitly
    // remeasured into viewport coordinates when that content moves.
    gridRect = { left: -88, top: -48, width: 640, height: 480 };
    fireEvent.scroll(scroll);
    await waitFor(() => expect(annotation).toHaveStyle({ left: "-88px", top: "-48px" }));

    gridRect = { left: -88, top: -48, width: 800, height: 600 };
    fireEvent(window, new Event("resize"));
    await waitFor(() => {
      expect(annotation).toHaveStyle({ width: "800px", height: "600px" });
      expect(annotation).toHaveAttribute("viewBox", "0 0 800 600");
    });

    rerender(<TerminalPresentation recording={value} currentTime={150} terminalFactory={async () => terminal} />);
    await waitFor(() => expect(screen.queryByTestId("mouse-annotation")).not.toBeInTheDocument());

    rerender(<TerminalPresentation recording={value} currentTime={100} terminalFactory={async () => terminal} />);
    expect(await screen.findByTestId("mouse-annotation")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("mouse-annotation")).not.toBeInTheDocument(), { timeout: 1_000 });
  });

  it("ignores invalid mouse metadata without interrupting terminal playback", async () => {
    const terminal = new FakeTerminal(80, 24);
    const value = recording("invalid-mouse.twee", [
      output("start", 0, "A"),
      {
        id: "invalid", time: 50, type: "input", inputKind: "mouse", bytes: new Uint8Array(),
        mouse: { gesture: "click", x: 80, y: 0, button: "left", modifiers: [] },
      },
      output("end", 100, "B"),
    ], 100);
    const { rerender } = render(
      <TerminalPresentation recording={value} currentTime={0} terminalFactory={async () => terminal} />,
    );
    expect(await screen.findByText("A")).toBeInTheDocument();

    rerender(<TerminalPresentation recording={value} currentTime={100} terminalFactory={async () => terminal} />);
    await waitFor(() => expect(terminal.screen.endsWith("AB")).toBe(true));
    expect(screen.queryByTestId("mouse-annotation")).not.toBeInTheDocument();
  });

  it("seeks forward incrementally, applies resize in file order, and replays after a backward seek", async () => {
    const terminal = new FakeTerminal(80, 24);
    const value = recording();
    const factory = async () => terminal;
    const { rerender } = render(
      <TerminalPresentation recording={value} currentTime={0} terminalFactory={factory} />,
    );
    expect(await screen.findByText("A")).toBeInTheDocument();

    rerender(<TerminalPresentation recording={value} currentTime={310} terminalFactory={factory} />);
    expect(await screen.findByText("ABC")).toBeInTheDocument();
    expect(terminal.resizes).toEqual([[100, 30]]);
    expect(terminal.resets).toEqual([]);

    rerender(<TerminalPresentation recording={value} currentTime={210} terminalFactory={factory} />);
    await waitFor(() => expect(terminal.screen).toBe("AB"));
    expect(terminal.resets).toEqual([[80, 24]]);
    expect(terminal.cols).toBe(80);
    expect(terminal.rows).toBe(24);
  });

  it("gives the same screen for direct and forward/backward paths", async () => {
    const terminal = new FakeTerminal(80, 24);
    const value = recording();
    const factory = async () => terminal;
    const { rerender } = render(
      <TerminalPresentation recording={value} currentTime={300} terminalFactory={factory} />,
    );
    expect(await screen.findByText("ABC")).toBeInTheDocument();
    const direct = terminal.screen;

    rerender(<TerminalPresentation recording={value} currentTime={50} terminalFactory={factory} />);
    await waitFor(() => expect(terminal.screen).toBe("A"));
    rerender(<TerminalPresentation recording={value} currentTime={300} terminalFactory={factory} />);
    await waitFor(() => expect(terminal.screen).toBe(direct));
  });

  it("coalesces rapid seeks into at most one formatter call per animation frame", async () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      nextFrame += 1;
      frames.set(nextFrame, callback);
      return nextFrame;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((frame: number) => frames.delete(frame)));

    const terminal = new FakeTerminal(80, 24);
    const value = recording();
    const factory = vi.fn(async () => terminal);
    const { rerender } = render(
      <TerminalPresentation recording={value} currentTime={0} terminalFactory={factory} />,
    );
    await act(async () => undefined);

    rerender(<TerminalPresentation recording={value} currentTime={300} terminalFactory={factory} />);
    rerender(<TerminalPresentation recording={value} currentTime={50} terminalFactory={factory} />);
    rerender(<TerminalPresentation recording={value} currentTime={300} terminalFactory={factory} />);

    expect(frames.size).toBe(1);
    expect(terminal.formats).toBe(0);
    const callbacks = [...frames.values()];
    frames.clear();
    act(() => callbacks.forEach((callback) => callback(performance.now())));
    expect(terminal.formats).toBe(1);
    expect(terminal.screen).toBe("ABC");
  });

  it("disposes the old terminal when a recording is replaced and on unmount", async () => {
    const terminals: FakeTerminal[] = [];
    const factory = async (cols: number, rows: number) => {
      const terminal = new FakeTerminal(cols, rows);
      terminals.push(terminal);
      return terminal;
    };
    const first = recording("first.twee", [output("first", 0, "first")]);
    const second = recording("second.twee", [output("second", 0, "second")]);
    const { rerender, unmount } = render(
      <TerminalPresentation recording={first} currentTime={0} terminalFactory={factory} />,
    );
    expect(await screen.findByText("first")).toBeInTheDocument();

    rerender(<TerminalPresentation recording={second} currentTime={0} terminalFactory={factory} />);
    expect(await screen.findByText("second")).toBeInTheDocument();
    expect(terminals[0].disposed).toBe(true);

    unmount();
    expect(terminals[1].disposed).toBe(true);
  });

  it("shows terminal factory loading and error states", async () => {
    let rejectFactory: (error: Error) => void = () => undefined;
    const factory = () => new Promise<GhosttyTerminal>((_resolve, reject) => {
      rejectFactory = reject;
    });
    render(<TerminalPresentation recording={recording()} currentTime={0} terminalFactory={factory} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading terminal");

    act(() => rejectFactory(new Error("WASM unavailable")));
    expect(await screen.findByRole("alert")).toHaveTextContent("WASM unavailable");
  });
});

describe("Ghostty formatter sanitization", () => {
  it("preserves Ghostty palette and cell styles from formatter-shaped HTML", () => {
    const ghosttyHTML = `
      <style>:root { --vt-palette-1: #cc0000; --vt-palette-255: rgb(1, 2, 3); --vt-palette-999: #ffffff; }</style>
      <div style="display: inline">
        <div style="color: var(--vt-palette-1); font-weight: bold; text-decoration-line: underline">
          <a href="https://example.test/" onclick="steal()">styled</a>
        </div>
        <div style="visibility: hidden; filter: invert(100%)">cursor</div>
        <div style="color:var(--vt-palette-999)">bad palette</div>
      </div>`;
    const tree = sanitizeGhosttyHTML(ghosttyHTML);
    const markup = renderToStaticMarkup(<>{tree}</>);
    const { container } = render(<div>{tree}</div>);

    expect(markup).toContain("--vt-palette-1:rgb(178, 24, 24)");
    expect(markup).toContain("--vt-palette-255:rgb(238, 238, 238)");
    expect(markup).not.toContain("--vt-palette-999");
    expect(markup).toContain("display:inline");
    expect(markup).toContain("color:var(--vt-palette-1)");
    expect(markup).toContain("font-weight:bold");
    expect(markup).toContain("text-decoration-line:underline");
    expect(markup).toContain("visibility:hidden");
    expect(markup).toContain("color:rgb(0, 0, 0);background-color:rgb(200, 200, 200)");
    expect(markup).not.toContain("filter:invert");
    expect(container.querySelector("a")).toBeNull();
    expect(container).toHaveTextContent("styled");
  });

  it("keeps wide and combining graphemes on the terminal cell grid", () => {
    const markup = renderToStaticMarkup(<>{sanitizeGhosttyHTML("<pre>界e&#x301;</pre>")}</>);
    expect(markup).toContain('data-terminal-cell-width="2"');
    expect(markup).toContain("width:2ch");
    expect(markup).toContain("界");
    expect(markup).toContain("é");
  });

  it("matches pinned native widths for modifier, flag, variation, and keycap sequences", () => {
    const { container } = render(<div>{sanitizeGhosttyHTML("<pre>👍🏻🇺🇸❤️1️⃣</pre>")}</div>);
    const wideCells = Array.from(container.querySelectorAll('[data-terminal-cell-width="2"]'));
    expect(wideCells).toHaveLength(4);
    expect(wideCells.map((cell) => cell.textContent)).toEqual(["👍", "🏻", "🇺", "🇸"]);
    expect(container).toHaveTextContent("👍🏻🇺🇸❤️1️⃣");
  });

  it("translates inverse and faint into Twee's native foreground/background semantics", () => {
    const markup = renderToStaticMarkup(<>{sanitizeGhosttyHTML(`
      <div style="color:var(--vt-palette-1);background-color:var(--vt-palette-4);filter:invert(100%)">I</div>
      <div style="color:var(--vt-palette-1);background-color:var(--vt-palette-4);opacity:0.5">D</div>
    `)}</>);

    expect(markup).toContain("color:var(--vt-palette-4);background-color:var(--vt-palette-1)");
    expect(markup).toContain("color:rgb(89, 12, 12);background-color:var(--vt-palette-4)");
    expect(markup).not.toContain("filter:invert");
    expect(markup).not.toContain("opacity:0.5");
  });

  it("rebuilds a strict element and style set without links, handlers, or active content", () => {
    const hostile = `
      <pre style="--vt-palette-1:#ff0000;background-image:url(javascript:alert(1))" onclick="alert(1)">
        &lt;script&gt;visible text&lt;/script&gt;
        <a href="javascript:alert(1)" onmouseover="alert(1)"><span style="color:var(--vt-palette-1);position:fixed">linked</span></a>
        <script>removed()</script><img src=x onerror="alert(1)"><marquee>kept text</marquee>
      </pre>`;
    const { container } = render(<div>{sanitizeGhosttyHTML(hostile)}</div>);

    expect(container).toHaveTextContent("<script>visible text</script>");
    expect(container).toHaveTextContent("linked");
    expect(container).toHaveTextContent("kept text");
    expect(container.querySelector("a,script,img,marquee")).toBeNull();
    const pre = container.querySelector("pre");
    const span = container.querySelector("span");
    expect(pre).not.toHaveAttribute("onclick");
    expect(pre?.style.getPropertyValue("--vt-palette-1")).toBe("");
    expect(pre?.style.backgroundImage).toBe("");
    expect(span?.style.position).toBe("");
    // jsdom 20 rejects CSS var() as a color, while browsers accept it. React's
    // static renderer still proves the rebuilt style retains Ghostty's value.
    const markup = renderToStaticMarkup(<>{sanitizeGhosttyHTML(hostile)}</>);
    expect(markup).toContain("--vt-palette-1:rgb(178, 24, 24)");
    expect(markup).toContain("color:var(--vt-palette-1)");
  });

  it("unwraps Ghostty OSC 8 links while preserving styled link text", () => {
    const { container } = render(
      <div>{sanitizeGhosttyHTML('<pre><a href="https://example.test/"><span style="font-weight:bold">linked</span></a></pre>')}</div>,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByText("linked")).toHaveStyle({ fontWeight: "bold" });
  });

  it("retains safe decorations when Ghostty also emits blink", () => {
    const { container } = render(
      <div>{sanitizeGhosttyHTML('<div style="text-decoration-line: underline blink">alert</div>')}</div>,
    );

    expect(screen.getByText("alert")).toHaveStyle({ textDecorationLine: "underline" });
  });
});
