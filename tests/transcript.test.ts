import { describe, expect, it } from "vitest";
import { buildTranscript, checkInput, formatTime, type DeepgramResponse } from "../lib/transcript";

// Times are halves so the expected values below are exact.
const word = (text: string, start: number) => ({
  word: text.toLowerCase(),
  punctuated_word: text,
  start,
  end: start + 0.5,
});

function response(duration: number, utterances: NonNullable<DeepgramResponse["results"]["utterances"]>): DeepgramResponse {
  return { metadata: { duration }, results: { utterances } };
}

describe("buildTranscript", () => {
  it("splits utterances into sentences and keeps the speaker of each", () => {
    const t = buildTranscript(
      response(20, [
        { speaker: 0, words: [word("Hi,", 0), word("I'm", 0.5), word("Dana.", 1), word("Ready?", 2)] },
        { speaker: 1, words: [word("Yes", 4), word("I", 4.5), word("am", 5)] },
      ]),
    );
    expect(t.segments).toEqual([
      { id: 1, speaker: 0, start: 0, end: 1.5, text: "Hi, I'm Dana." },
      { id: 2, speaker: 0, start: 2, end: 2.5, text: "Ready?" },
      { id: 3, speaker: 1, start: 4, end: 5.5, text: "Yes I am" },
    ]);
    expect(t.speakers).toEqual([0, 1]);
    expect(t.durationSec).toBe(20);
  });

  it("uses the plain word when there is no punctuated form", () => {
    const t = buildTranscript(response(5, [{ speaker: 0, words: [{ word: "okay", start: 0, end: 0.4 }] }]));
    expect(t.segments[0].text).toBe("okay");
  });

  it("returns no segments when Deepgram heard nothing", () => {
    expect(buildTranscript({ metadata: { duration: 10 }, results: {} }).segments).toEqual([]);
  });
});

describe("checkInput", () => {
  const two = buildTranscript(
    response(60, [
      { speaker: 0, words: [word("Hello.", 0)] },
      { speaker: 1, words: [word("Hi.", 2)] },
    ]),
  );

  it("accepts two speakers within the limit, including the 0.5 s tolerance", () => {
    expect(checkInput(two)).toBeNull();
    expect(checkInput({ ...two, durationSec: 180.4 })).toBeNull();
  });

  it("declines audio longer than 3 minutes", () => {
    expect(checkInput({ ...two, durationSec: 180.6 })?.reason).toBe("too_long");
  });

  it("declines audio without speech", () => {
    expect(checkInput({ durationSec: 10, speakers: [], segments: [] })?.reason).toBe("no_speech");
  });

  it("declines one speaker and three speakers", () => {
    expect(checkInput({ ...two, speakers: [0] })?.reason).toBe("speaker_count");
    expect(checkInput({ ...two, speakers: [0, 1, 2] })?.reason).toBe("speaker_count");
  });
});

describe("formatTime", () => {
  it("formats seconds as m:ss", () => {
    expect(formatTime(75.4)).toBe("1:15");
    expect(formatTime(5)).toBe("0:05");
  });
});
