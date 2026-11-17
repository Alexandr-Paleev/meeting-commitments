// Settings from env, with their defaults in one place.
// Only AUDIO_LIMITS is used in the browser; everything else is read on the server.

// Checked in the browser and again on the server.
// 4,000,000 bytes keeps the raw request body under Vercel's 4.5 MB limit.
export const AUDIO_LIMITS = {
  maxBytes: 4_000_000,
  maxSeconds: 180,
  toleranceSeconds: 0.5,
} as const;

// Gemini thinking levels (not every model supports every level; the API rejects a wrong one).
export type ThinkingLevel = "minimal" | "low" | "medium" | "high";
const THINKING_LEVELS: ThinkingLevel[] = ["minimal", "low", "medium", "high"];

export function serverConfig() {
  const thinkingLevel = process.env.EXTRACT_THINKING_LEVEL || "high";
  if (!THINKING_LEVELS.includes(thinkingLevel as ThinkingLevel)) {
    throw new Error(`EXTRACT_THINKING_LEVEL must be one of: ${THINKING_LEVELS.join(", ")}`);
  }
  return {
    // The fastest free tier model; larger ones took 88 to 294 s on a 10-line test (WORKLOG).
    extractModel: process.env.EXTRACT_MODEL || "gemini-3.5-flash-lite",
    extractThinkingLevel: thinkingLevel as ThinkingLevel,
    // true when GEMINI_API_KEY is on Gemini's paid tier; lifts the region block in lib/limits.ts
    geminiPaidTier: process.env.GEMINI_PAID_TIER === "true",
    sttModel: process.env.STT_MODEL || "nova-3",
    rateLimitPerIpPerHour: positiveInt("RATE_LIMIT_PER_IP_PER_HOUR", 20),
    dailyRequestCap: positiveInt("DAILY_REQUEST_CAP", 100),
  };
}

export function secret(name: "DEEPGRAM_API_KEY" | "GEMINI_API_KEY" | "TRANSCRIPT_SIGNING_SECRET"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see .env.example)`);
  return value;
}

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}
