// The extraction step: one Claude call with structured output, the checks in lib/verify.ts,
// one retry with the problems described, then the fallback for whatever still fails.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { serverConfig } from "./config";
import { llmCostUsd, tokenPrice } from "./pricing";
import { SYSTEM_PROMPT, problemsMessage, transcriptMessage } from "./prompt";
import { Extraction } from "./schema";
import type { Transcript } from "./transcript";
import { applyChecks, verify, type Checked, type Problem } from "./verify";

export type ExtractMetrics = {
  model: string;
  effort: string;
  calls: number; // 1, or 2 when the checks asked for a retry
  retries: number;
  extractSeconds: number;
  inputTokens: number;
  outputTokens: number; // includes thinking tokens
  thinkingTokens: number;
  llmCostUsd: number;
};

export type ExtractResult = Checked & {
  problems: { first: string[]; final: string[] }; // what the checks found, before and after the retry
  metrics: ExtractMetrics;
};

// The model stopped without a complete answer (a refusal or the token limit). Not retried:
// the same request would most likely stop the same way.
export class ModelStopError extends Error {}

const describe = (problems: Problem[]) =>
  problems.map((p) => `${p.section}${p.index >= 0 ? `[${p.index}]` : ""}: ${p.message}`);

export async function extract(transcript: Transcript): Promise<ExtractResult> {
  const { extractModel: model, extractEffort: effort } = serverConfig();
  tokenPrice(model); // throws before any spend if the model has no price in lib/pricing.ts
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY
  const started = performance.now();
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: transcriptMessage(transcript) }];
  const responses: Anthropic.Message[] = [];

  async function call(): Promise<Extraction> {
    const response = await client.messages.create({
      model,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort, format: zodOutputFormat(Extraction) },
      system: SYSTEM_PROMPT,
      messages,
    });
    responses.push(response);
    if (response.stop_reason !== "end_turn") {
      const category = response.stop_details?.category;
      throw new ModelStopError(
        `The model stopped without a complete answer (${response.stop_reason}${category ? `: ${category}` : ""}).`,
      );
    }
    const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    return Extraction.parse(JSON.parse(text));
  }

  let extraction = await call();
  const first = verify(extraction, transcript);
  let final = first;
  if (first.length > 0) {
    // The previous answer goes back unchanged (thinking blocks included), then the problems.
    messages.push(
      { role: "assistant", content: responses[0].content },
      { role: "user", content: problemsMessage(first) },
    );
    extraction = await call();
    final = verify(extraction, transcript);
  }

  const sum = (pick: (r: Anthropic.Message) => number) => responses.reduce((total, r) => total + pick(r), 0);
  return {
    ...applyChecks(extraction, final, transcript),
    problems: { first: describe(first), final: describe(final) },
    metrics: {
      model,
      effort,
      calls: responses.length,
      retries: responses.length - 1,
      extractSeconds: (performance.now() - started) / 1000,
      inputTokens: sum((r) => r.usage.input_tokens + (r.usage.cache_creation_input_tokens ?? 0) + (r.usage.cache_read_input_tokens ?? 0)),
      outputTokens: sum((r) => r.usage.output_tokens),
      thinkingTokens: sum((r) => r.usage.output_tokens_details?.thinking_tokens ?? 0),
      llmCostUsd: sum((r) => llmCostUsd(model, r.usage)),
    },
  };
}
