// @ts-nocheck -- test fixtures use loose shapes
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import RecordStudio from "../components/RecordStudio";

describe("while a recording is on its way", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState({}, "", "/");
  });

  it("shows the turning record from the first paint, for as long as the download takes", async () => {
    window.history.pushState({}, "", "/?record=slow.zip");
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);

    render(<RecordStudio />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading record…");
    expect(screen.queryByText(/Drag & drop/)).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/slow.zip"));
    expect(screen.getByRole("status")).toHaveTextContent("Loading record…");
  });

  it("gives way to the error when the download fails", async () => {
    window.history.pushState({}, "", "/?record=gone.zip");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404, statusText: "Not Found" })));

    render(<RecordStudio />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to fetch gone.zip");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows no loader on a page with nothing to load", () => {
    render(<RecordStudio />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText(/Drag & drop/)).toBeInTheDocument();
  });

  it("asks an embedded player with no file for a recording", () => {
    render(<RecordStudio hideGlobalChrome />);
    expect(screen.getByText("Drop a recording here")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
