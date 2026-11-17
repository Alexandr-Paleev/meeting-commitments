// Pricing config: every price the app or the eval uses, with its source and the date it was read.
// List prices (pay as you go). Free credits are ignored on purpose: they are not zero operating cost.

const RETRIEVED = "2026-11-12";

export const SOURCES = {
  gemini: "https://ai.google.dev/gemini-api/docs/pricing",
  deepgram: "https://deepgram.com/pricing",
  vercel: "https://vercel.com/pricing",
} as const;

// Speech to text: Deepgram Nova-3, pre-recorded, monolingual. Diarization is included in this
// rate for pre-recorded audio.
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

// Gemini, USD per million tokens: paid tier list prices (Standard). The demo runs on the free tier,
// but free usage is not zero operating cost, so the eval and the notes report these prices.
// Thinking tokens are billed as output tokens; cached input is implicit caching.
// gemini-3.8-flash doubles from 2027-01-01 (input 1.5, output 7.5, cached 0.15).
export type TokenPrice = { inputPerMTok: number; outputPerMTok: number; cachedInputPerMTok: number };

export const GEMINI_PRICES: Record<string, TokenPrice> = {
  "gemini-4-hydrogen": { inputPerMTok: 1.5, outputPerMTok: 7.5, cachedInputPerMTok: 0.075 },
  "gemini-3.8-flash": { inputPerMTok: 0.75, outputPerMTok: 3.75, cachedInputPerMTok: 0.075 },
};
export const GEMINI_PRICE_META = { source: SOURCES.gemini, retrieved: "2026-11-17" };

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
  const price = GEMINI_PRICES[model];
  if (!price) throw new Error(`No price for model "${model}" in lib/pricing.ts`);
  return price;
}

// Token counts as reported in the response's usageMetadata. promptTokenCount includes the cached
// tokens; candidatesTokenCount does not include the thinking tokens.
export type TokenUsage = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
};

export function llmCostUsd(model: string, usage: TokenUsage): number {
  const price = tokenPrice(model);
  const cached = usage.cachedContentTokenCount ?? 0;
  const input = (usage.promptTokenCount ?? 0) - cached;
  const output = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
  return (input * price.inputPerMTok + cached * price.cachedInputPerMTok + output * price.outputPerMTok) / 1_000_000;
}
