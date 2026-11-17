// Formatting used by both the server and the browser, so it imports nothing with server code.

import { AUDIO_LIMITS } from "./config";

// 75.4 -> "1:15"
export function formatTime(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

// The same words for the browser's early check and the server's check.
export function tooLongMessage(seconds: number): string {
  return `The recording is ${formatTime(seconds)} long. The limit is ${formatTime(AUDIO_LIMITS.maxSeconds)}.`;
}
