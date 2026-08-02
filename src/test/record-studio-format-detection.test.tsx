import { render, screen } from "@testing-library/react";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RecordStudio from "../components/RecordStudio";

describe("RecordStudio format detection", () => {
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

  it("routes Vibium directly to its tolerant legacy parser", async () => {
    const zip = new JSZip();
    zip.file(
      "trace.trace",
      [
        "{truncated legacy line",
        JSON.stringify({
          type: "before",
          callId: "call@1",
          class: "Page",
          method: "vibium:page.navigate",
          title: "Page.navigate",
          startTime: 0,
        }),
        JSON.stringify({ type: "after", callId: "call@1", endTime: 100 }),
      ].join("\n"),
    );
    const file = await zip.generateAsync({ type: "uint8array" });
    Object.defineProperty(file, "name", { value: "legacy-record.zip" });

    render(<RecordStudio initialFile={file} hideGlobalChrome />);

    expect(await screen.findByText("No screenshots in this trace")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actions (1)" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
