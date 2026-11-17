// The retry loop with the Anthropic SDK replaced by a fake. No network, no cost.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { extract, ModelStopError } from "../lib/extract";
import type { Extraction } from "../lib/schema";
import { transcript, validExtraction } from "./fixtures";

// vi.mock is hoisted above the imports, so lib/extract.ts gets the fake client.
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create }; } }));

const reply = (x: Extraction, stop_reason = "end_turn") => ({
  content: [{ type: "text", text: JSON.stringify(x) }],
  stop_reason,
  stop_details: null,
  usage: {
    input_tokens: 1_000,
    output_tokens: 500,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens_details: { thinking_tokens: 200 },
  },
});

function withBadOwner(): Extraction {
  const x = validExtraction();
  x.commitments[0].owner = { name: "Dana", evidence: [4] };
  return x;
}

beforeEach(() => create.mockReset());

describe("extract", () => {
  it("makes one call when the checks pass", async () => {
    create.mockResolvedValueOnce(reply(validExtraction()));
    const result = await extract(transcript);
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.metrics).toMatchObject({ calls: 1, retries: 0, inputTokens: 1_000, outputTokens: 500, thinkingTokens: 200 });
    // Opus 5.5 list prices: $4 per million input tokens, $20 per million output tokens.
    expect(result.metrics.llmCostUsd).toBeCloseTo(0.004 + 0.01);
    expect(result.commitments).toHaveLength(2);
  });

  it("retries once with the problems described and keeps the fixed answer", async () => {
    create.mockResolvedValueOnce(reply(withBadOwner())).mockResolvedValueOnce(reply(validExtraction()));
    const result = await extract(transcript);
    expect(create).toHaveBeenCalledTimes(2);
    const retryMessages = create.mock.calls[1][0].messages;
    expect(retryMessages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(retryMessages[2].content).toContain('commitments[0]: owner "Dana"');
    expect(result.metrics).toMatchObject({ calls: 2, retries: 1 });
    expect(result.problems.first).toHaveLength(1);
    expect(result.problems.final).toEqual([]);
    expect(result.moved).toBe(0);
  });

  it("moves an item that still fails after the retry", async () => {
    create.mockResolvedValueOnce(reply(withBadOwner())).mockResolvedValueOnce(reply(withBadOwner()));
    const result = await extract(transcript);
    expect(create).toHaveBeenCalledTimes(2);
    expect(result.moved).toBe(1);
    expect(result.commitments.map((c) => c.task)).toEqual(["Update the wiki"]);
  });

  it("stops with a clear error when the model refuses", async () => {
    create.mockResolvedValueOnce(reply(validExtraction(), "refusal"));
    await expect(extract(transcript)).rejects.toBeInstanceOf(ModelStopError);
  });
});
