// @ts-nocheck -- test fixtures use loose shapes
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { parseRecording } from "../packages/player-core";
import { __recordStudioInternals } from "../components/RecordStudio";

const { audioView, browserRecordingView, humanizeAction, isHumanAction, scheduleSounds, stepDetail } = __recordStudioInternals;

// A recording of one question and its answer, as Vibium writes it: the
// steps in the trace, and the audio beside it with a manifest.
async function speechZip(manifest: unknown = undefined): Promise<Uint8Array> {
  const lines = [
    { type: "context-options", options: {} },
    { type: "before", callId: "call@1", class: "Page", method: "vibium:touch.tap", title: "Page.touch.tap", startTime: 500, params: { x: 1, y: 2 } },
    { type: "after", callId: "call@1", endTime: 600 },
    { type: "before", callId: "call@2", class: "Speech", method: "vibium:speech.say", title: "Speech.say", startTime: 1000, params: { text: "Come here, Watson" } },
    { type: "after", callId: "call@2", endTime: 2700, result: { clip: "out-0001", playStartMs: 1100, playEndMs: 2690 } },
    { type: "before", callId: "call@3", class: "Speech", method: "vibium:speech.listen", title: "Speech.listen", startTime: 2800, params: { timeout: 15000 } },
    { type: "after", callId: "call@3", endTime: 10000, result: { text: "Come here, Watson.", onsetMs: 7300, speechEndMs: 8800, latencyMs: 4610 } },
  ];
  const zip = new JSZip();
  zip.file("trace.trace", lines.map((line) => JSON.stringify(line)).join("\n"));
  zip.file("trace.network", "");
  zip.file("audio/index.json", JSON.stringify(manifest ?? {
    version: 1,
    tracks: [{ id: "in-session", target: "session", file: "audio/in-session.wav", startMs: 1050, durationMs: 9000, speech: [{ startMs: 7300, endMs: 8800 }] }],
    clips: [{ id: "out-0001", file: "audio/out-0001.wav", durationMs: 1590, text: "Come here, Watson", provider: "openai", voice: "alloy",
      plays: [{ callId: "call@2", startMs: 1100, endMs: 2690 }] }],
    transcripts: [{ callId: "call@3", track: "in-session", text: "Come here, Watson.", onsetMs: 7300, speechEndMs: 8800, latencyMs: 4610 }],
  }));
  zip.file("audio/in-session.wav", new Uint8Array([82, 73, 70, 70, 1, 2, 3]));
  zip.file("audio/out-0001.wav", new Uint8Array([82, 73, 70, 70, 9]));
  zip.file("secret.txt", "not audio");
  return zip.generateAsync({ type: "uint8array" });
}

describe("a recording's audio", () => {
  it("is read from the archive with its manifest", async () => {
    const recording = await parseRecording(await speechZip());
    if (recording.format !== "vibium") throw new Error("expected a Vibium recording");
    expect(recording.audio?.tracks).toHaveLength(1);
    expect(recording.audio?.tracks[0]).toMatchObject({ id: "in-session", startMs: 1050, durationMs: 9000, speech: [{ startMs: 7300, endMs: 8800 }] });
    expect(Array.from(recording.audio!.tracks[0].data!)).toEqual([82, 73, 70, 70, 1, 2, 3]);
    expect(recording.audio?.clips[0]).toMatchObject({ id: "out-0001", text: "Come here, Watson", plays: [{ callId: "call@2", startMs: 1100, endMs: 2690 }] });
    expect(recording.audio?.transcripts[0]).toMatchObject({ callId: "call@3", text: "Come here, Watson.", latencyMs: 4610 });
  });

  it("is absent from a recording without it, or with a manifest this player does not know", async () => {
    const zip = new JSZip();
    zip.file("trace.trace", JSON.stringify({ type: "before", callId: "call@1", method: "vibium:page.navigate", startTime: 1 }));
    const plain = await parseRecording(await zip.generateAsync({ type: "uint8array" }));
    expect(plain.format === "vibium" && plain.audio).toBeFalsy();

    const newer = await parseRecording(await speechZip({ version: 2, tracks: [{ id: "x", file: "audio/in-session.wav" }] }));
    expect(newer.format === "vibium" && newer.audio).toBeFalsy();
    expect(newer.timeline.events.filter((event) => event.kind === "action")).toHaveLength(3);
  });

  it("only reads files under audio/", async () => {
    const recording = await parseRecording(await speechZip({ version: 1, tracks: [{ id: "t", file: "secret.txt", startMs: 0, durationMs: 1 }], clips: [], transcripts: [] }));
    expect(recording.format === "vibium" && recording.audio?.tracks[0].data).toBeUndefined();
  });
});

describe("playing a recording's audio", () => {
  it("places each sound on the player's timeline, which starts at the first event", async () => {
    const recording = await parseRecording(await speechZip());
    const view = browserRecordingView(recording);
    // The first event is at 500 ms of recording time, so that is the timeline's zero.
    expect(view.timelineStart).toBe(500);
    expect(view.audio.sounds.map((sound: { id: string; kind: string; startTime: number }) => [sound.id, sound.kind, sound.startTime])).toEqual([
      ["in-session", "heard", 550],
      ["out-0001@0", "said", 600],
    ]);
    expect(audioView({ format: "playwright", timeline: { startTime: 0 } })).toBeNull();
  });

  it("starts each sound where the playhead is", () => {
    const sounds = [{ id: "track", startTime: 550 }, { id: "clip", startTime: 600 }, { id: "undecoded", startTime: 0 }];
    const durations = new Map([["track", 9], ["clip", 1.59]]);
    // From the start: both wait for their moment.
    expect(scheduleSounds(sounds, durations, 0, 1)).toEqual([
      { id: "track", delay: 0.55, offset: 0 },
      { id: "clip", delay: 0.6, offset: 0 },
    ]);
    // From the middle of the track, after the clip has ended, at double speed.
    expect(scheduleSounds(sounds, durations, 5550, 2)).toEqual([{ id: "track", delay: 0, offset: 5 }]);
    // A sound still ahead waits half as long at double speed.
    expect(scheduleSounds(sounds, durations, 100, 2)[1]).toEqual({ id: "clip", delay: 0.25, offset: 0 });
    // Past everything: nothing plays.
    expect(scheduleSounds(sounds, durations, 60_000, 1)).toEqual([]);
  });
});

describe("a step's detail", () => {
  it("prints the result beside the parameters", async () => {
    const view = browserRecordingView(await parseRecording(await speechZip()));
    const [tap, say, listen] = view.actions;
    // What a listen heard is in its result, not its parameters.
    const heard = stepDetail(listen);
    expect(JSON.parse(heard.params)).toEqual({ timeout: 15000 });
    expect(JSON.parse(heard.result)).toMatchObject({ text: "Come here, Watson.", latencyMs: 4610 });
    expect(JSON.parse(stepDetail(say).result)).toMatchObject({ clip: "out-0001" });
    // A step with no result has none to print.
    expect(stepDetail(tap).result).toBeNull();
    expect(stepDetail({ params: { x: 1 }, result: {} }).result).toBeNull();
  });

  it("puts the text first in a result", () => {
    const heard = stepDetail({ params: {}, result: { audioEndMs: 9, latencyMs: 4610, provider: "openai", text: "Come here, Watson." } });
    expect(Object.keys(JSON.parse(heard.result))).toEqual(["text", "audioEndMs", "latencyMs", "provider"]);
    expect(heard.result.split("\n")[1]).toContain("Come here, Watson.");
    // A result with no text keeps its order.
    expect(Object.keys(JSON.parse(stepDetail({ params: {}, result: { clip: "out-0001", durationMs: 5 } }).result))).toEqual(["clip", "durationMs"]);
  });

  it("hides what a sensitive field gave back while masking is on", () => {
    const read = { params: { selector: "#password", value: "hunter2" }, result: { value: "hunter2" } };
    expect(stepDetail(read)).toEqual({ params: JSON.stringify({ selector: "#password", value: "••••••" }, null, 2), result: "••••••" });
    expect(JSON.parse(stepDetail(read, false).result)).toEqual({ value: "hunter2" });
  });

  it("cuts a very long string", () => {
    const page = stepDetail({ params: {}, result: { text: "a".repeat(5000) } });
    expect(JSON.parse(page.result).text).toHaveLength(2001);
  });
});

describe("captions for say and listen", () => {
  it("quotes what was said and what was heard", async () => {
    const view = browserRecordingView(await parseRecording(await speechZip()));
    const [, say, listen] = view.actions;
    expect(humanizeAction(say)).toBe("Say “Come here, Watson”");
    expect(humanizeAction(listen)).toBe("Heard “Come here, Watson.”");
    expect(isHumanAction(say.apiName) && isHumanAction(listen.apiName)).toBe(true);
    // Until the reply begins the caption says it is listening. The reply
    // began at 7300 ms of recording time, which is 6800 on the timeline.
    expect(humanizeAction(listen, true, 3000, 6800)).toBe("Listening…");
    expect(humanizeAction(listen, true, 6900, 6800)).toBe("Heard “Come here, Watson.”");
  });

  it("covers a clip from a file, a listen that failed and one not transcribed", () => {
    expect(humanizeAction({ apiName: "Speech.say", params: { file: "/tmp/clips/question.wav" } })).toBe("Play question.wav");
    expect(humanizeAction({ apiName: "Speech.listen", params: {}, error: { message: "no_speech: ..." } })).toBe("Heard nothing");
    expect(humanizeAction({ apiName: "Speech.listen", params: {}, result: { text: "", speech: true } })).toBe("Listen");
    expect(humanizeAction({ apiName: "Page.navigate", params: { url: "https://example.com" } })).toBe("Navigate to example.com");
    expect(isHumanAction("Element.text")).toBe(false);
  });
});
