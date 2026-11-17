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

// Vercel sets x-forwarded-for to the client's public IP and overwrites any value the client sends.
export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
