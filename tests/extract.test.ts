// The retry loop with the Gemini client replaced by a fake. No network, no cost.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extract, ModelStopError } from "../lib/extract";
import { SYSTEM_PROMPT } from "../lib/prompt";
import type { Extraction } from "../lib/schema";
import { transcript, validExtraction } from "./fixtures";

// vi.mock is hoisted above the imports, so lib/extract.ts gets the fake client. The rest of the
// SDK (enums such as FinishReason) stays real.
const { generateContent, clientOptions } = vi.hoisted(() => ({ generateContent: vi.fn(), clientOptions: [] as unknown[] }));
vi.mock("@google/genai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@google/genai")>()),
  GoogleGenAI: class {
    models = { generateContent };
    constructor(options: unknown) {
      clientOptions.push(options);
    }
  },
}));

const reply = (x: Extraction, finishReason = "STOP") => {
  const text = JSON.stringify(x);
  return {
    text,
    candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason }],
    usageMetadata: { promptTokenCount: 1_000, candidatesTokenCount: 300, thoughtsTokenCount: 200 },
  };
};

function withBadOwner(): Extraction {
  const x = validExtraction();
  x.commitments[0].owner = { name: "Dana", evidence: [4] };
  return x;
}

beforeEach(() => {
  generateContent.mockReset();
  vi.stubEnv("GEMINI_API_KEY", "test-key");
});
afterEach(() => vi.unstubAllEnvs());

describe("extract", () => {
  it("lets the SDK retry server errors, but not the quota error 429", async () => {
    generateContent.mockResolvedValueOnce(reply(validExtraction()));
    await extract(transcript);
    const { retryOptions } = (clientOptions.at(-1) as { httpOptions: { retryOptions: { attempts: number; httpStatusCodes: number[] } } }).httpOptions;
    expect(retryOptions.attempts).toBe(3);
    expect(retryOptions.httpStatusCodes).toContain(503);
    expect(retryOptions.httpStatusCodes).not.toContain(429);
  });

  it("makes one call when the checks pass", async () => {
    generateContent.mockResolvedValueOnce(reply(validExtraction()));
    const result = await extract(transcript);
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(result.metrics).toMatchObject({ calls: 1, retries: 0, inputTokens: 1_000, outputTokens: 500, thinkingTokens: 200 });
    // gemini-3.5-flash-lite list prices: $0.30 per million input tokens, $2.50 per million output tokens.
    expect(result.metrics.llmCostUsd).toBeCloseTo(0.0003 + 0.00125);
    expect(result.commitments).toHaveLength(2);
  });

  it("sends the system prompt, the JSON schema and the thinking level", async () => {
    generateContent.mockResolvedValueOnce(reply(validExtraction()));
    await extract(transcript);
    const { model, config } = generateContent.mock.calls[0][0];
    expect(model).toBe("gemini-3.5-flash-lite");
    expect(config).toMatchObject({ systemInstruction: SYSTEM_PROMPT, responseMimeType: "application/json" });
    expect(config.thinkingConfig).toEqual({ thinkingLevel: "HIGH" });
    expect(config.responseJsonSchema).toHaveProperty("properties.commitments");
    expect(config.responseJsonSchema).not.toHaveProperty("$schema");
  });

  it("retries once with the previous answer and the problems described", async () => {
    generateContent.mockResolvedValueOnce(reply(withBadOwner())).mockResolvedValueOnce(reply(validExtraction()));
    const result = await extract(transcript);
    expect(generateContent).toHaveBeenCalledTimes(2);
    const contents = generateContent.mock.calls[1][0].contents;
    expect(contents.map((c: { role: string }) => c.role)).toEqual(["user", "model", "user"]);
    expect(contents[2].parts[0].text).toContain('commitments[0]: owner "Dana"');
    expect(result.metrics).toMatchObject({ calls: 2, retries: 1 });
    expect(result.problems.first).toHaveLength(1);
    expect(result.problems.final).toEqual([]);
    expect(result.moved).toBe(0);
  });

  it("moves an item that still fails after the retry", async () => {
    generateContent.mockResolvedValueOnce(reply(withBadOwner())).mockResolvedValueOnce(reply(withBadOwner()));
    const result = await extract(transcript);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(result.moved).toBe(1);
    expect(result.commitments.map((c) => c.task)).toEqual(["Update the wiki"]);
  });

  it("stops with a clear error when the retry does not finish its answer either", async () => {
    // An answer that does not finish with STOP is an error shown to the user (CLAUDE.md), even on the retry.
    generateContent.mockResolvedValueOnce(reply(withBadOwner())).mockResolvedValueOnce(reply(validExtraction(), "MAX_TOKENS"));
    const error = await extract(transcript).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ModelStopError);
  });

  it("stops with a clear error when the model does not finish its answer", async () => {
    generateContent.mockResolvedValueOnce(reply(validExtraction(), "MAX_TOKENS"));
    const error = await extract(transcript).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ModelStopError);
    expect((error as Error).message).toContain("MAX_TOKENS");
  });
});
