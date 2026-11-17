// Step 1 of 2: audio in, transcript out. The browser shows the transcript right away and then
// sends it to /api/extract. No audio is stored: the bytes go to Deepgram and are dropped.

import { AUDIO_LIMITS } from "@/lib/config";
import { clientIp, takeRequest } from "@/lib/limits";
import { signTranscript } from "@/lib/sign";
import { transcribeAudio } from "@/lib/transcript";

export const maxDuration = 60; // seconds; speech to text of 3 minutes of audio takes a few

const error = (status: number, message: string, headers?: HeadersInit) =>
  Response.json({ error: message }, { status, headers });

export async function POST(request: Request) {
  const allowance = takeRequest(clientIp(request));
  if (!allowance.ok) return error(429, allowance.message, { "Retry-After": String(allowance.retryAfterSec) });

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("audio/") && !contentType.startsWith("video/")) {
    return error(415, "Please upload an audio or video file.");
  }
  const tooLarge = `The file is larger than ${AUDIO_LIMITS.maxBytes / 1_000_000} MB.`;
  if (Number(request.headers.get("content-length") ?? 0) > AUDIO_LIMITS.maxBytes) return error(413, tooLarge);
  const audio = await request.arrayBuffer();
  if (audio.byteLength > AUDIO_LIMITS.maxBytes) return error(413, tooLarge);
  if (audio.byteLength === 0) return error(400, "The file is empty.");

  try {
    const result = await transcribeAudio(audio, contentType);
    // Only a transcript that can go on to extraction gets a signature.
    const signature = result.decline ? null : signTranscript(result.transcript);
    return Response.json({ ...result, signature });
  } catch (e) {
    console.error("transcribe failed", e);
    return error(502, "Speech recognition failed. Please try again.");
  }
}
