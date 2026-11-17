// Signature, prices, limits and the prompt messages.

import { describe, expect, it, vi } from "vitest";
import { llmCostUsd, sttCostUsd, tokenPrice } from "../lib/pricing";
import { problemsMessage, transcriptMessage } from "../lib/prompt";
import { hasValidSignature, signTranscript } from "../lib/sign";
import { transcript } from "./fixtures";

describe("transcript signature", () => {
  process.env.TRANSCRIPT_SIGNING_SECRET = "test-secret";
  // What the browser sends back: the same object after a JSON round trip.
  const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value));

  it("accepts the transcript exactly as the server produced it", () => {
    expect(hasValidSignature(roundTrip(transcript), signTranscript(transcript))).toBe(true);
  });

  it("rejects an edited transcript and a bad signature", () => {
    const edited = roundTrip(transcript);
    edited.segments[3].text = "No, I won't.";
    expect(hasValidSignature(edited, signTranscript(transcript))).toBe(false);
    expect(hasValidSignature(transcript, "not-hex")).toBe(false);
    expect(hasValidSignature(transcript, undefined)).toBe(false);
  });
});

describe("pricing", () => {
  it("prices tokens at the list rates", () => {
    expect(llmCostUsd("claude-opus-5-5", { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(4);
    expect(llmCostUsd("claude-opus-5-5", { input_tokens: 0, output_tokens: 1_000_000 })).toBeCloseTo(20);
    expect(llmCostUsd("claude-opus-5-5", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 })).toBeCloseTo(0.2);
  });

  it("prices speech to text per audio minute", () => {
    expect(sttCostUsd("nova-3", 60)).toBeCloseTo(0.0043);
  });

  it("fails loudly for a model without a price", () => {
    expect(() => tokenPrice("some-other-model")).toThrow(/No price/);
    expect(() => sttCostUsd("nova-2", 60)).toThrow(/No price/);
  });
});

describe("limits", () => {
  it("applies the per-IP limit and the daily cap, then resets on a new day", async () => {
    vi.stubEnv("RATE_LIMIT_PER_IP_PER_HOUR", "2");
    vi.stubEnv("DAILY_REQUEST_CAP", "3");
    vi.resetModules();
    const { takeRequest } = await import("../lib/limits");
    const now = Date.parse("2026-11-17T10:00:00Z");
    expect(takeRequest("1.1.1.1", now).ok).toBe(true);
    expect(takeRequest("1.1.1.1", now).ok).toBe(true);
    expect(takeRequest("1.1.1.1", now).ok).toBe(false); // third request from this address in the hour
    expect(takeRequest("2.2.2.2", now).ok).toBe(true); // third request of the day
    const capped = takeRequest("3.3.3.3", now);
    expect(capped.ok).toBe(false);
    expect(!capped.ok && capped.retryAfterSec).toBe(14 * 60 * 60); // until UTC midnight
    expect(takeRequest("3.3.3.3", Date.parse("2026-11-18T00:00:01Z")).ok).toBe(true);
    vi.unstubAllEnvs();
  });
});

describe("prompt messages", () => {
  it("numbers the segments with their speaker labels", () => {
    const text = transcriptMessage(transcript);
    expect(text).toContain("[1] S0: Hi, I'm Dana from the platform team.");
    expect(text).toContain("<transcript>");
  });

  it("lists every problem with its item", () => {
    const text = problemsMessage([{ section: "commitments", index: 2, message: "owner is not supported" }]);
    expect(text).toContain("- commitments[2]: owner is not supported");
  });
});
