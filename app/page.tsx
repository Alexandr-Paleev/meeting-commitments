"use client";

// The whole app is this page. The browser runs the two steps in order: the audio goes to
// /api/transcribe and the transcript is shown, then the signed transcript goes to /api/extract.
// A bundled sample is fetched as a file and goes through exactly the same steps as an upload.

import { useEffect, useState } from "react";
import { AUDIO_LIMITS } from "@/lib/config";
import type { ExtractResult } from "@/lib/extract";
import { formatTime, tooLongMessage } from "@/lib/format";
import type { Decline, TranscribeResult } from "@/lib/transcript";
import { QuoteContext, TranscriptView, usePlayer } from "./quotes";
import { DeclineCard, Results, RunDetails } from "./results";

type Transcribed = TranscribeResult & { signature: string | null };
type Step = "idle" | "checking" | "transcribing" | "extracting" | "done";

const STEP_TEXT: Partial<Record<Step, string>> = {
  checking: "Checking the file",
  transcribing: "Transcribing the recording",
  extracting: "Finding the commitments",
};

// public/samples/*.mp3; samples/README.md says what each one tests.
const SAMPLES = [
  { name: "A", label: "Launch check-in" },
  { name: "B", label: "Same, one agreement changed" },
  { name: "C", label: "Workshop, one open agreement" },
  { name: "D", label: "Names never said" },
  { name: "E", label: "Silence" },
  { name: "F", label: "Too long" },
];

export default function Page() {
  const player = usePlayer();
  const [step, setStep] = useState<Step>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [fileName, setFileName] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [stt, setStt] = useState<Transcribed | null>(null);
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [earlyDecline, setEarlyDecline] = useState<Decline | null>(null); // the browser's own check
  const [error, setError] = useState<string | null>(null);
  const busy = step === "checking" || step === "transcribing" || step === "extracting";

  // Seconds since the current step started, so a long wait still shows progress.
  useEffect(() => {
    if (step !== "transcribing" && step !== "extracting") return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [step]);

  function go(next: Step) {
    setElapsed(0);
    setStep(next);
  }

  function stopWith(message: string) {
    setError(message);
    setStep("done");
  }

  async function start(file: File) {
    go("checking");
    player.stop();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    const url = URL.createObjectURL(file);
    setAudioUrl(url);
    setFileName(file.name);
    setStt(null);
    setResult(null);
    setEarlyDecline(null);
    setError(null);

    // The limits are checked here first, so a file that would be refused is never uploaded.
    // The server checks them again.
    if (file.size > AUDIO_LIMITS.maxBytes) return stopWith(`The file is larger than ${AUDIO_LIMITS.maxBytes / 1_000_000} MB.`);
    const seconds = await readDuration(url);
    if (seconds !== null && seconds > AUDIO_LIMITS.maxSeconds + AUDIO_LIMITS.toleranceSeconds) {
      setEarlyDecline({ reason: "too_long", message: tooLongMessage(seconds) });
      return setStep("done");
    }

    go("transcribing");
    const res = await post<Transcribed>("/api/transcribe", file, file.type || "application/octet-stream");
    if (!res.ok) return stopWith(res.error);
    setStt(res.data);
    if (res.data.decline || !res.data.signature) return setStep("done");
    await extract(res.data);
  }

  async function extract(t: Transcribed) {
    setError(null);
    go("extracting");
    const res = await post<ExtractResult>("/api/extract", JSON.stringify({ transcript: t.transcript, signature: t.signature }), "application/json");
    if (!res.ok) return stopWith(res.error);
    setResult(res.data);
    setStep("done");
  }

  async function startSample(name: string) {
    go("checking");
    const res = await fetch(`/samples/${name}.mp3`).catch(() => null);
    if (!res?.ok) return stopWith("Could not load the sample. Please try again.");
    await start(new File([await res.blob()], `${name}.mp3`, { type: "audio/mpeg" }));
  }

  const names = new Map(result?.speakers.map((s) => [s.label, s.name]));
  const quotes = {
    segments: new Map(stt?.transcript.segments.map((s) => [s.id, s])),
    speakerName: (label: number) => names.get(label) ?? `S${label}`,
    playing: player.playing,
    toggle: player.toggle,
  };
  const decline = earlyDecline ?? stt?.decline ?? result?.decline ?? null;

  return (
    <main>
      <header>
        <h1>Meeting commitments</h1>
        <p className="lead">
          Upload a short recording of two people planning work. You get the tasks they agreed on, with owner and deadline, and
          what was not agreed, what is still open and what needs clarification. Every value comes with the quote it rests on:
          press ▶ to hear it.
        </p>
      </header>

      <section className="input">
        <div className="pick">
          <label className={busy ? "button primary disabled" : "button primary"}>
            Choose a recording
            <input
              type="file"
              accept="audio/*,video/*"
              className="visually-hidden"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = ""; // so the same file can be chosen again
                if (file) void start(file);
              }}
            />
          </label>
          <span className="hint">
            English, two speakers who say their names, up to {AUDIO_LIMITS.maxSeconds / 60} minutes and{" "}
            {AUDIO_LIMITS.maxBytes / 1_000_000} MB.
          </span>
        </div>
        <div className="samples">
          <span className="hint">Or try a sample:</span>
          {SAMPLES.map((s) => (
            <button key={s.name} type="button" className="button" disabled={busy} onClick={() => void startSample(s.name)}>
              <strong>{s.name}</strong> {s.label}
            </button>
          ))}
        </div>
        <p className="notice">
          This demo runs on Google&apos;s free Gemini tier. Google may use what you upload to improve its products, and human
          reviewers may read it. Please do not upload real meetings or anything confidential.
        </p>
      </section>

      {audioUrl && (
        <section className="recording">
          <span className="hint">{fileName}</span>
          <audio ref={player.audio} src={audioUrl} controls preload="auto" />
        </section>
      )}

      {busy && (
        <p className="progress" role="status">
          {STEP_TEXT[step]}
          {elapsed > 0 && `, ${elapsed} s`}
        </p>
      )}

      {error && (
        <div className="error" role="alert">
          <p>{error}</p>
          {stt?.signature && !result && !busy && (
            <button type="button" className="button" onClick={() => void extract(stt)}>
              Try again
            </button>
          )}
        </div>
      )}

      <QuoteContext value={quotes}>
        {decline && <DeclineCard decline={decline} />}
        {result && !result.decline && <Results result={result} />}
        {stt && stt.transcript.segments.length > 0 && (
          <details className="section" open={!result || result.decline !== null}>
            <summary>
              Transcript: {stt.transcript.segments.length} segments, {formatTime(stt.transcript.durationSec)}
            </summary>
            <TranscriptView segments={stt.transcript.segments} />
          </details>
        )}
        {stt && <RunDetails stt={stt} result={result} />}
      </QuoteContext>
    </main>
  );
}

// The browser's own reading of the duration. null when it cannot read the format; the server
// checks the duration again in any case.
function readDuration(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const probe = new Audio();
    probe.preload = "metadata";
    probe.onloadedmetadata = () => resolve(Number.isFinite(probe.duration) ? probe.duration : null);
    probe.onerror = () => resolve(null);
    probe.src = url;
  });
}

// Both routes answer with JSON: the result, or { error } with a message meant for the user.
async function post<T>(url: string, body: BodyInit, contentType: string): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body, headers: { "Content-Type": contentType } });
  } catch {
    return { ok: false, error: "Could not reach the server. Please check the connection and try again." };
  }
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  if (res.ok && json) return { ok: true, data: json as T };
  if (json?.error) return { ok: false, error: json.error };
  return { ok: false, error: res.status === 504 ? "The server took too long. Please try again." : `The server answered with status ${res.status}.` };
}
