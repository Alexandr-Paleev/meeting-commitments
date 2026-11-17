// Step 2 of 2: the signed transcript in, the commitments list out.

import { ApiError } from "@google/genai";
import { extract, ModelStopError } from "@/lib/extract";
import { clientIp, REGION_MESSAGE, regionBlocked, takeRequest } from "@/lib/limits";
import { hasValidSignature } from "@/lib/sign";
import { Transcript } from "@/lib/transcript";

export const maxDuration = 300; // seconds; Vercel's default and the Hobby maximum

const error = (status: number, message: string, headers?: HeadersInit) =>
  Response.json({ error: message }, { status, headers });

export async function POST(request: Request) {
  if (regionBlocked(request)) return error(451, REGION_MESSAGE);
  const allowance = takeRequest(clientIp(request));
  if (!allowance.ok) return error(429, allowance.message, { "Retry-After": String(allowance.retryAfterSec) });

  let body: { transcript?: unknown; signature?: unknown };
  try {
    body = await request.json();
  } catch {
    return error(400, "The request body must be JSON.");
  }
  if (!hasValidSignature(body.transcript, body.signature)) {
    return error(400, "This transcript was not produced by this server. Please upload the audio again.");
  }
  const transcript = Transcript.parse(body.transcript);

  try {
    return Response.json(await extract(transcript));
  } catch (e) {
    if (e instanceof ModelStopError) return error(502, e.message);
    // 429 is the free tier quota, 503 means Gemini is overloaded even after the SDK's retries.
    if (e instanceof ApiError && (e.status === 429 || e.status === 503)) {
      return error(e.status, "The model is busy right now. Please try again in a minute.", { "Retry-After": "60" });
    }
    console.error("extract failed", e);
    return error(502, "Extraction failed. Please try again.");
  }
}
