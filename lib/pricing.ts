// Pricing config: every price the app or the eval uses, with its source and the date it was read.
// List prices (pay as you go). Free credits are ignored on purpose: they are not zero operating cost.

const RETRIEVED = "2026-11-12";

export const SOURCES = {
  anthropic: "https://platform.claude.com/docs/en/about-claude/pricing",
  deepgram: "https://deepgram.com/pricing",
  vercel: "https://vercel.com/pricing",
} as const;

// Speech to text: Deepgram Nova-3, pre-recorded, monolingual. Diarization and smart formatting
// are included in this rate for pre-recorded audio.
export const STT_PRICE = {
  model: "nova-3",
  usdPerMinute: 0.0043,
  source: SOURCES.deepgram,
  retrieved: RETRIEVED,
};

// Text to speech, used only by scripts/generate-samples.ts to create the test recordings.
export const TTS_PRICE = {
  model: "aura-2",
  usdPer1kCharacters: 0.03,
  source: SOURCES.deepgram,
  retrieved: RETRIEVED,
};

// Claude, USD per million tokens. Thinking tokens are billed as output tokens.
// Haiku 5.5 rates are the tier for prompts up to 100k tokens (our prompts are far smaller).
// claude-opus-5 and claude-opus-4-8 can serve a request only if the refusal fallback is enabled
// (deferred, see CLAUDE.md decisions from 2026-11-17).
export type TokenPrice = {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWrite5mPerMTok: number;
  cacheReadPerMTok: number;
};

export const CLAUDE_PRICES: Record<string, TokenPrice> = {
  "claude-opus-5-5": { inputPerMTok: 4, outputPerMTok: 20, cacheWrite5mPerMTok: 5, cacheReadPerMTok: 0.2 },
  "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10, cacheWrite5mPerMTok: 2.5, cacheReadPerMTok: 0.1 },
  "claude-haiku-5-5": { inputPerMTok: 0.1, outputPerMTok: 0.5, cacheWrite5mPerMTok: 0.125, cacheReadPerMTok: 0.01 },
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25, cacheWrite5mPerMTok: 6.25, cacheReadPerMTok: 0.5 },
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25, cacheWrite5mPerMTok: 6.25, cacheReadPerMTok: 0.5 },
};
export const CLAUDE_PRICE_META = { source: SOURCES.anthropic, retrieved: RETRIEVED };

// Hosting, reported separately from variable cost. Vercel Pro list rates (iad1, the default region).
// The $20 per seat per month plan fee is a fixed cost and not part of the per-operation number.
export const HOSTING_PRICE = {
  plan: "Vercel Pro",
  activeCpuUsdPerHour: 0.128,
  memoryUsdPerGbHour: 0.0106,
  invocationsUsdPerMillion: 0.6,
  source: SOURCES.vercel,
  retrieved: RETRIEVED,
};

export function ttsCostUsd(characters: number): number {
  return (characters / 1000) * TTS_PRICE.usdPer1kCharacters;
}

// Deepgram bills pre-recorded audio by its duration.
export function sttCostUsd(model: string, audioSeconds: number): number {
  if (model !== STT_PRICE.model) throw new Error(`No price for STT model "${model}" in lib/pricing.ts`);
  return (audioSeconds / 60) * STT_PRICE.usdPerMinute;
}

export function tokenPrice(model: string): TokenPrice {
  const price = CLAUDE_PRICES[model];
  if (!price) throw new Error(`No price for model "${model}" in lib/pricing.ts`);
  return price;
}

// The token counts as reported in the API response's usage field.
export type TokenUsage = {
  input_tokens: number;
  output_tokens: number; // includes thinking tokens
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export function llmCostUsd(model: string, usage: TokenUsage): number {
  const price = tokenPrice(model);
  const total =
    usage.input_tokens * price.inputPerMTok +
    usage.output_tokens * price.outputPerMTok +
    (usage.cache_creation_input_tokens ?? 0) * price.cacheWrite5mPerMTok +
    (usage.cache_read_input_tokens ?? 0) * price.cacheReadPerMTok;
  return total / 1_000_000;
}
