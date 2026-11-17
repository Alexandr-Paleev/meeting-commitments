// Why this exists: the server keeps no state between /api/transcribe and /api/extract, so the
// transcript travels through the browser. The HMAC proves that the transcript sent to
// /api/extract is exactly the one our server produced from the audio. Nobody can feed arbitrary
// text to the paid model, and every quote still points at the real recording.
// The browser must send the transcript back exactly as it received it.

import { createHmac, timingSafeEqual } from "node:crypto";
import { secret } from "./config";

export function signTranscript(transcript: unknown): string {
  return createHmac("sha256", secret("TRANSCRIPT_SIGNING_SECRET"))
    .update(JSON.stringify(transcript))
    .digest("hex");
}

export function hasValidSignature(transcript: unknown, signature: unknown): boolean {
  if (typeof signature !== "string") return false;
  const expected = Buffer.from(signTranscript(transcript), "hex");
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
