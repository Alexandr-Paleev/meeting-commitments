// The extraction step: one Gemini call with structured output, the checks in lib/verify.ts,
// one retry with the problems described, then the fallback for whatever still fails.

import { FinishReason, GoogleGenAI, ThinkingLevel, type Content, type GenerateContentResponse } from "@google/genai";
import { secret, serverConfig } from "./config";
import { llmCostUsd, tokenPrice, type TokenUsage } from "./pricing";
import { SYSTEM_PROMPT, problemsMessage, transcriptMessage } from "./prompt";
import { EXTRACTION_JSON_SCHEMA, Extraction } from "./schema";
import type { Transcript } from "./transcript";
import { applyChecks, verify, type Checked, type Problem } from "./verify";

export type ExtractMetrics = {
  model: string;
  thinkingLevel: string;
  calls: number; // 1, or 2 when the checks asked for a retry
  retries: number;
  extractSeconds: number;
  inputTokens: number;
  outputTokens: number; // includes thinking tokens, which are billed as output
  thinkingTokens: number;
  llmCostUsd: number; // at paid tier list prices, even when the free tier was used
};

export type ExtractResult = Checked & {
  problems: { first: string[]; final: string[] }; // what the checks found, before and after the retry
  metrics: ExtractMetrics;
};

// The model stopped without a complete answer (a safety block or the token limit). Not retried:
// the same request would most likely stop the same way.
export class ModelStopError extends Error {}

const LEVELS = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

const describe = (problems: Problem[]) =>
  problems.map((p) => `${p.section}${p.index >= 0 ? `[${p.index}]` : ""}: ${p.message}`);

export async function extract(transcript: Transcript): Promise<ExtractResult> {
  const { extractModel: model, extractThinkingLevel: thinkingLevel } = serverConfig();
  tokenPrice(model); // throws before any call if the model has no price in lib/pricing.ts
  const ai = new GoogleGenAI({ apiKey: secret("GEMINI_API_KEY") });
  const started = performance.now();
  const contents: Content[] = [{ role: "user", parts: [{ text: transcriptMessage(transcript) }] }];
  const responses: GenerateContentResponse[] = [];

  async function call(): Promise<Extraction> {
    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        maxOutputTokens: 32_000, // thinking tokens count toward this limit
        responseMimeType: "application/json",
        responseJsonSchema: EXTRACTION_JSON_SCHEMA,
        thinkingConfig: { thinkingLevel: LEVELS[thinkingLevel] },
      },
    });
    responses.push(response);
    const candidate = response.candidates?.[0];
    if (candidate?.finishReason !== FinishReason.STOP) {
      const reason = candidate?.finishReason ?? response.promptFeedback?.blockReason ?? "no answer";
      throw new ModelStopError(`The model stopped without a complete answer (${reason}).`);
    }
    return Extraction.parse(JSON.parse(response.text ?? ""));
  }

  let extraction = await call();
  const first = verify(extraction, transcript);
  let final = first;
  if (first.length > 0) {
    // The previous answer goes back unchanged (with its thought signatures), then the problems.
    contents.push(responses[0].candidates?.[0]?.content ?? { role: "model", parts: [] }, {
      role: "user",
      parts: [{ text: problemsMessage(first) }],
    });
    extraction = await call();
    final = verify(extraction, transcript);
  }

  const sum = (pick: (u: TokenUsage) => number) => responses.reduce((total, r) => total + pick(r.usageMetadata ?? {}), 0);
  return {
    ...applyChecks(extraction, final, transcript),
    problems: { first: describe(first), final: describe(final) },
    metrics: {
      model,
      thinkingLevel,
      calls: responses.length,
      retries: responses.length - 1,
      extractSeconds: (performance.now() - started) / 1000,
      inputTokens: sum((u) => u.promptTokenCount ?? 0),
      outputTokens: sum((u) => (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0)),
      thinkingTokens: sum((u) => u.thoughtsTokenCount ?? 0),
      llmCostUsd: sum((u) => llmCostUsd(model, u)),
    },
  };
}
