// Best-effort guards for a public demo: a per-IP hourly limit and a daily cap on paid calls.
// They live in memory, per server instance: on Vercel each instance counts on its own and the
// counters reset on a cold start. That is enough to stop accidental loops, not a real quota.

import { serverConfig } from "./config";

const HOUR_MS = 60 * 60 * 1000;
const day = { date: "", count: 0 };
const perIp = new Map<string, { since: number; count: number }>();

export type Allowance = { ok: true } | { ok: false; retryAfterSec: number; message: string };

// Counts one request (either API route) if it is allowed.
export function takeRequest(ip: string, now = Date.now()): Allowance {
  const { dailyRequestCap, rateLimitPerIpPerHour } = serverConfig();
  const today = new Date(now).toISOString().slice(0, 10); // UTC day
  if (day.date !== today) Object.assign(day, { date: today, count: 0 });
  if (day.count >= dailyRequestCap) {
    const nextUtcMidnight = Date.parse(`${today}T00:00:00Z`) + 24 * HOUR_MS;
    return { ok: false, retryAfterSec: Math.ceil((nextUtcMidnight - now) / 1000), message: "The demo's daily limit is reached. Please try again tomorrow." };
  }
  let entry = perIp.get(ip);
  if (!entry || now - entry.since >= HOUR_MS) {
    entry = { since: now, count: 0 };
    perIp.set(ip, entry);
  }
  if (entry.count >= rateLimitPerIpPerHour) {
    return { ok: false, retryAfterSec: Math.ceil((entry.since + HOUR_MS - now) / 1000), message: "Too many requests from your address. Please wait a little." };
  }
  day.count += 1;
  entry.count += 1;
  return { ok: true };
}

// Google's terms allow only the paid Gemini tier for apps offered to users in the EEA,
// Switzerland or the UK. On the free tier both routes refuse those visitors.
// Vercel sets x-vercel-ip-country (ISO 3166-1 alpha-2); local runs have no such header.
const PAID_TIER_ONLY = new Set([
  ...["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU"], // EU
  ...["IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK"], // EU
  ...["GF", "GP", "MQ", "RE", "YT", "MF", "AX"], // EU regions that geo-IP reports under their own codes
  ...["IS", "LI", "NO", "CH", "GB"], // rest of the EEA, Switzerland, UK
  ...["JE", "GG", "IM", "GI"], // Crown dependencies and Gibraltar, treated as the UK to be safe
]);

export const REGION_MESSAGE =
  "This public demo runs on Google's free Gemini tier, which may not be offered to users in the EEA, " +
  "Switzerland or the UK. Please watch the demo video, or run the app with your own paid key (see the README).";

export function regionBlocked(request: Request): boolean {
  if (serverConfig().geminiPaidTier) return false;
  const country = request.headers.get("x-vercel-ip-country")?.toUpperCase();
  return country !== undefined && PAID_TIER_ONLY.has(country);
}

// Vercel sets x-forwarded-for to the client's public IP and overwrites any value the client sends.
export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
