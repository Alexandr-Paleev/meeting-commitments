// Settings from env, with their defaults in one place.
// Only AUDIO_LIMITS is used in the browser; everything else is read on the server.

// Checked in the browser and again on the server.
// 4,000,000 bytes keeps the raw request body under Vercel's 4.5 MB limit.
export const AUDIO_LIMITS = {
  maxBytes: 4_000_000,
  maxSeconds: 180,
  toleranceSeconds: 0.5,
} as const;

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export function serverConfig() {
  const effort = process.env.EXTRACT_EFFORT || "high";
  if (!EFFORTS.includes(effort as Effort)) {
    throw new Error(`EXTRACT_EFFORT must be one of: ${EFFORTS.join(", ")}`);
  }
  return {
    extractModel: process.env.EXTRACT_MODEL || "claude-opus-5-5",
    extractEffort: effort as Effort,
    sttModel: process.env.STT_MODEL || "nova-3",
    rateLimitPerIpPerHour: positiveInt("RATE_LIMIT_PER_IP_PER_HOUR", 20),
    dailyRequestCap: positiveInt("DAILY_REQUEST_CAP", 100),
  };
}

// The Anthropic SDK reads ANTHROPIC_API_KEY itself; these two are read by our code.
export function secret(name: "DEEPGRAM_API_KEY" | "TRANSCRIPT_SIGNING_SECRET"): string {
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
