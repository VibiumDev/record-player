import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RecordStudio from "../components/RecordStudio";

describe("RecordStudio console UI", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/?i=v&t=h&c=h");
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
});
