import React from "react";
import { createRoot } from "react-dom/client";

import type { TweeEvent, TweeRecording } from "../../packages/player-core";
import { RecordPlayer, TerminalPresentation } from "../../packages/player-react";
import { nativeVTReference } from "../../packages/ghostty-browser/native-vt-reference";

const encoder = new TextEncoder();

function recording(
  events: TweeEvent[],
  duration: number,
  cols: number = nativeVTReference.initialCols,
  rows: number = nativeVTReference.initialRows,
): TweeRecording {
  return {
    version: 1,
    format: "twee",
    source: "native-reference.twee",
    files: ["manifest.json", "events.jsonl"],
    metadata: { fileCount: 2, eventCount: events.length },
    timeline: { startTime: 0, endTime: duration, duration, events },
    presentation: {
      kind: "terminal",
      initialCols: cols,
      initialRows: rows,
    },
    manifest: {
      version: 1,
      command: ["sh", "-lc", "visual-conformance"],
      cols,
      rows,
    },
    terminalEvents: events,
  };
}

const visualEvents: TweeEvent[] = nativeVTReference.events
  .filter((event) => event.time <= 10)
  .map((event, index) => "output" in event
    ? {
      id: `visual-output-${index}`,
      time: event.time,
      type: "output" as const,
      bytes: encoder.encode(event.output),
    }
    : {
      id: `visual-resize-${index}`,
      time: event.time,
      type: "resize" as const,
      cols: event.cols,
      rows: event.rows,
    });

const visualRecording = recording(visualEvents, 10);
const complexWidthRecording = recording([{
  id: "complex-widths",
  time: 0,
  type: "output",
  bytes: encoder.encode(
    nativeVTReference.complexWidthLines.map(({ input }) => input).join("\r\n") + "\u001b[?25l",
  ),
}], 0, 16, 4);
const attributeRecording = recording([{
  id: "native-attributes",
  time: 0,
  type: "output",
  bytes: encoder.encode("\u001b[31;44;7mI\u001b[0m\u001b[31;44;2mD\u001b[0m\u001b[?25l"),
}], 0, 4, 1);
const keyboardRecording = recording([
  { id: "keyboard-output", time: 0, type: "output", bytes: encoder.encode("keyboard") },
  { id: "keyboard-exit", time: 10_000, type: "exit", code: 0 },
], 10_000);

export function Harness() {
  return (
    <>
      <div id="native-image-target">
        <TerminalPresentation
          recording={visualRecording}
          currentTime={10}
          style={{
            width: 64,
            height: 60,
            minHeight: 60,
            padding: 0,
            borderRadius: 0,
            overflow: "hidden",
          }}
        />
      </div>
      <div id="complex-width-target" style={{ marginTop: 20 }}>
        <TerminalPresentation
          recording={complexWidthRecording}
          currentTime={0}
          style={{ width: 128, height: 80, minHeight: 80, padding: 0, borderRadius: 0 }}
        />
      </div>
      <div id="attribute-target" style={{ marginTop: 20 }}>
        <TerminalPresentation
          recording={attributeRecording}
          currentTime={0}
          style={{ width: 32, height: 20, minHeight: 20, padding: 0, borderRadius: 0 }}
        />
      </div>
      <div id="keyboard-target" style={{ width: 300, marginTop: 20 }}>
        <RecordPlayer
          recording={keyboardRecording}
          inspector="hidden"
          timeline="hidden"
          style={{ padding: 8 }}
        />
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
