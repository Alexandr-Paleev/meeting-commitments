// Speech to text and the transcript the rest of the app works with.
// Deepgram returns words with speaker labels. We re-split them into sentence-sized segments,
// so each quote is short and its play button plays just that sentence.

import { z } from "zod";
import { AUDIO_LIMITS, secret, serverConfig } from "./config";
import { tooLongMessage } from "./format";
import { sttCostUsd } from "./pricing";

export const Segment = z.object({
  id: z.number(), // 1, 2, 3, ... in speaking order
  speaker: z.number(), // diarization label from Deepgram: 0, 1, ...
  start: z.number(), // seconds from the start of the audio
  end: z.number(),
  text: z.string(),
});
export const Transcript = z.object({
  durationSec: z.number(),
  speakers: z.array(z.number()), // distinct labels, ascending
  segments: z.array(Segment),
});
export type Segment = z.infer<typeof Segment>;
export type Transcript = z.infer<typeof Transcript>;

export type DeclineReason =
  | "no_speech"
  | "too_long"
  | "speaker_count"
  | "speakers_not_identified"
  | "unintelligible";
export type Decline = { reason: DeclineReason; message: string };

export type TranscribeResult = {
  transcript: Transcript;
  decline: Decline | null;
  metrics: { sttModel: string; audioSeconds: number; sttSeconds: number; sttCostUsd: number };
};

// Only the fields we read from Deepgram's pre-recorded response (requested with utterances=true).
const DeepgramResponse = z.object({
  metadata: z.object({ duration: z.number() }),
  results: z.object({
    utterances: z
      .array(
        z.object({
          speaker: z.number(),
          words: z.array(
            z.object({
              word: z.string(),
              punctuated_word: z.string().optional(),
              start: z.number(),
              end: z.number(),
            }),
          ),
        }),
      )
      .optional(),
  }),
});
export type DeepgramResponse = z.infer<typeof DeepgramResponse>;

export async function transcribeAudio(audio: ArrayBuffer, contentType: string): Promise<TranscribeResult> {
  const { sttModel } = serverConfig();
  const started = performance.now();
  const params = new URLSearchParams({
    model: sttModel,
    language: "en",
    // Punctuation drives our sentence split. Not smart_format: it rewrites spoken dates ("the first
    // of March twenty twenty seven" becomes "03/01/2027"), so quotes would not be verbatim.
    // Numbers therefore stay in words.
    punctuate: "true",
    diarize_model: "latest", // speaker labels; the older diarize=true is deprecated
    utterances: "true", // utterance words carry punctuated_word and the speaker
  });
  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: { Authorization: `Token ${secret("DEEPGRAM_API_KEY")}`, "Content-Type": contentType },
    body: audio,
  });
  if (!res.ok) throw new Error(`Deepgram ${res.status}: ${await res.text()}`);
  const transcript = buildTranscript(DeepgramResponse.parse(await res.json()));
  return {
    transcript,
    decline: checkInput(transcript),
    metrics: {
      sttModel,
      audioSeconds: transcript.durationSec,
      sttSeconds: (performance.now() - started) / 1000,
      sttCostUsd: sttCostUsd(sttModel, transcript.durationSec),
    },
  };
}

const SENTENCE_END = /[.?!]["')\]]*$/;

export function buildTranscript(response: DeepgramResponse): Transcript {
  const segments: Segment[] = [];
  let words: string[] = [];
  let speaker = 0;
  let start = 0;
  let end = 0;
  const flush = () => {
    if (words.length > 0) segments.push({ id: segments.length + 1, speaker, start, end, text: words.join(" ") });
    words = [];
  };
  for (const utterance of response.results.utterances ?? []) {
    // A new speaker always starts a new segment. The same speaker's next utterance continues an
    // unfinished sentence: Deepgram can end an utterance in the middle of one.
    if (utterance.speaker !== speaker) flush();
    speaker = utterance.speaker;
    for (const word of utterance.words) {
      if (words.length === 0) start = word.start;
      const text = word.punctuated_word ?? word.word;
      words.push(text);
      end = word.end;
      if (SENTENCE_END.test(text)) flush();
    }
  }
  flush();
  const speakers = [...new Set(segments.map((s) => s.speaker))].sort((a, b) => a - b);
  return { durationSec: response.metadata.duration, speakers, segments };
}

// Input-level declines that need no language understanding. The model adds two more:
// speakers who never say their names, and unintelligible speech.
export function checkInput(transcript: Transcript): Decline | null {
  if (transcript.durationSec > AUDIO_LIMITS.maxSeconds + AUDIO_LIMITS.toleranceSeconds) {
    return { reason: "too_long", message: tooLongMessage(transcript.durationSec) };
  }
  if (transcript.segments.length === 0) {
    return { reason: "no_speech", message: "No speech was found in the recording." };
  }
  if (transcript.speakers.length !== 2) {
    return {
      reason: "speaker_count",
      message: `Found ${transcript.speakers.length} speaker(s). This app needs a conversation between exactly two people.`,
    };
  }
  return null;
}
