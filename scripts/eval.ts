// Runs the bundled samples through the real pipeline (the functions the API routes call) and checks
// each output against samples/<name>.expected.json with scripts/eval-checks.ts.
// Writes eval/report.md for people and eval/runs.json with every output behind the report.
//
// Usage: npm run eval -- [--runs N] [--out DIR] [A B ...]   (default: 3 runs of every sample, eval/)
// Needs DEEPGRAM_API_KEY and GEMINI_API_KEY in .env.local. Every run spends Deepgram credit and
// Gemini free tier quota; the report shows the cost at list prices. Settings from env apply, for
// example EXTRACT_THINKING_LEVEL=medium npm run eval -- --out eval/medium
// npm run eval -- --saved [--out DIR] checks the outputs in DIR/runs.json again and rewrites both
// files, without any API call (after a change to the checks, the expected files or the report).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ApiError } from "@google/genai";
import { serverConfig } from "../lib/config";
import { extract } from "../lib/extract";
import { formatTime } from "../lib/format";
import { HOSTING_PRICE, hostingCostUsd } from "../lib/pricing";
import { transcribeAudio } from "../lib/transcript";
import { actualDifference, checkRun, expectedDifference, type Check, type Expected, type Manifest, type RunOutput } from "./eval-checks";

type RunRecord = { run: number; output?: RunOutput; error?: string; retried: string[]; checks: Check[]; signatures: Record<string, string> };
type SampleRecord = { name: string; expected: Expected; manifest: Manifest; runs: RunRecord[] };
type Setup = { sttModel: string; extractModel: string; thinkingLevel: string; runs: number };
type Saved = { generatedAt: string; recheckedAt?: string; setup: Setup; samples: SampleRecord[] };

const ALL = ["A", "B", "C", "D", "E", "F"];
// Network failures and server errors are retried, and the report lists them. Quota errors (429)
// and a model that stops early are results, not retried.
const ATTEMPTS = 3;

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const describe = (e: unknown) => (e instanceof Error ? `${e.message}${e.cause instanceof Error ? ` (${e.cause.message})` : ""}` : String(e));

async function runPipeline(name: string): Promise<Pick<RunRecord, "output" | "error" | "retried">> {
  const mp3 = readFileSync(`public/samples/${name}.mp3`);
  const audio = mp3.buffer.slice(mp3.byteOffset, mp3.byteOffset + mp3.byteLength) as ArrayBuffer;
  const retried: string[] = [];
  for (let attempt = 1; ; attempt++) {
    try {
      const stt = await transcribeAudio(audio, "audio/mpeg");
      const extraction = stt.decline ? null : await extract(stt.transcript);
      return { output: { stt, extraction }, retried };
    } catch (e) {
      const transient = e instanceof TypeError || (e instanceof ApiError && e.status >= 500) || /^Deepgram 5\d\d/.test(describe(e));
      if (!transient || attempt === ATTEMPTS) return { error: describe(e), retried };
      retried.push(describe(e));
      await wait(5_000);
    }
  }
}

function write(dir: string, saved: Saved) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/runs.json`, `${JSON.stringify(saved, null, 2)}\n`);
  writeFileSync(`${dir}/report.md`, report(saved));
  console.log(`Wrote ${dir}/report.md and ${dir}/runs.json`);
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const dir = option("--out") ?? "eval";
  if (args.includes("--saved")) {
    const saved = readJson<Saved>(`${dir}/runs.json`);
    for (const s of saved.samples) {
      s.expected = readJson(`samples/${s.name}.expected.json`);
      s.manifest = readJson(`samples/manifests/${s.name}.json`);
      for (const r of s.runs) if (r.output) Object.assign(r, checkRun(s.expected, s.manifest, r.output));
    }
    return write(dir, { ...saved, recheckedAt: new Date().toISOString() });
  }

  process.loadEnvFile(".env.local"); // does not override variables already set in the shell
  const runs = Number(option("--runs") ?? 3);
  const chosen = args.filter((a) => ALL.includes(a));
  const names = chosen.length > 0 ? chosen : ALL;
  if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs needs a positive whole number");

  const started = new Date();
  const samples: SampleRecord[] = [];
  for (const name of names) {
    const sample: SampleRecord = {
      name,
      expected: readJson(`samples/${name}.expected.json`),
      manifest: readJson(`samples/manifests/${name}.json`),
      runs: [],
    };
    samples.push(sample);
    for (let run = 1; run <= runs; run++) {
      const result = await runPipeline(name);
      const checked = result.output
        ? checkRun(sample.expected, sample.manifest, result.output)
        : { checks: [{ name: "pipeline finished", status: "fail" as const, detail: result.error }], signatures: {} };
      sample.runs.push({ run, ...result, ...checked });
      const failed = checked.checks.filter((c) => c.status === "fail").map((c) => c.name);
      console.log(`${name} run ${run}: ${failed.length === 0 ? "pass" : `FAIL (${failed.join("; ")})`}${result.retried.length ? `, ${result.retried.length} error(s) retried` : ""}`);
    }
  }

  const config = serverConfig();
  const setup = { sttModel: config.sttModel, extractModel: config.extractModel, thinkingLevel: config.extractThinkingLevel, runs };
  write(dir, { generatedAt: started.toISOString(), setup, samples });
}

// The report

const passed = (r: RunRecord) => r.checks.every((c) => c.status === "pass");
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? NaN : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const mean = (xs: number[]) => (xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length);
const seconds = (x: number) => (Number.isNaN(x) ? "-" : `${x.toFixed(1)} s`);
const usd = (x: number) => (Number.isNaN(x) ? "-" : x > 0 && x < 0.00005 ? "under $0.0001" : `$${x.toFixed(4)}`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const whole = (x: number) => (Number.isNaN(x) ? "-" : Math.round(x).toLocaleString("en"));
const cell = (text: string) => text.replaceAll("|", "\\|");
const runCost = (o: RunOutput) => o.stt.metrics.sttCostUsd + (o.extraction?.metrics.llmCostUsd ?? 0);

function report({ generatedAt, recheckedAt, setup, samples }: Saved): string {
  const out: string[] = [];
  const day = (iso: string) => `${iso.slice(0, 16).replace("T", " at ")} UTC`;
  const partial = samples.length < ALL.length;
  const allRuns = samples.flatMap((s) => s.runs);
  const outputs = allRuns.flatMap((r) => (r.output ? [r.output] : []));
  const extractions = outputs.flatMap((o) => (o.extraction ? [o.extraction] : []));

  out.push(
    "# Eval report",
    "",
    `Generated by \`npm run eval\` on ${day(generatedAt)}${recheckedAt ? `, outputs checked again on ${day(recheckedAt)}` : ""}. Do not edit by hand: run the eval again.${partial ? " Partial run: only some samples." : ""}`,
    "",
    `- Each sample ran ${setup.runs} times through the functions the API routes call: speech to text, then extraction with the checks and one retry.`,
    `- Speech to text: Deepgram ${setup.sttModel}. Extraction: ${setup.extractModel}, thinking ${setup.thinkingLevel}, on the Gemini free tier.`,
    "- Expected results: `samples/<name>.expected.json`, drafted by Claude from the scripts before any pipeline run, then reviewed and committed by the user. How each check works: `samples/README.md`.",
    "- Quote times are compared with the true line times in `samples/manifests/<name>.json`, with 0.3 s tolerance.",
    '- A run passes only when every check passes. "skip" means a check was not made because the check it depends on failed (for example the owner of an item that was not found). It counts as not passed.',
    "",
    "## Summary",
    "",
    "| Sample | Recording | Expected | Runs passed | Checks passed |",
    "|---|---|---|---|---|",
  );
  for (const s of samples) {
    const expected = s.expected.decline
      ? `decline: ${s.expected.decline}`
      : `${plural(s.expected.items?.length ?? 0, "item")}, ${plural(s.expected.mustNotBeAgreed?.length ?? 0, "thing")} that must not be agreed`;
    const checks = s.runs.flatMap((r) => r.checks);
    out.push(
      `| ${s.name} | ${cell(s.manifest.title)} | ${expected} | ${s.runs.filter(passed).length} of ${s.runs.length} | ${checks.filter((c) => c.status === "pass").length} of ${checks.length} |`,
    );
  }

  // B vs A, run by run: the outputs must differ in exactly the items whose expected values differ.
  const a = samples.find((s) => s.name === "A");
  const b = samples.find((s) => s.name === "B");
  const pairs: string[] = [];
  if (a && b) {
    const want = expectedDifference(a.expected, b.expected);
    let ok = 0;
    for (let i = 0; i < Math.min(a.runs.length, b.runs.length); i++) {
      const [ra, rb] = [a.runs[i], b.runs[i]];
      if (!ra.output || !rb.output) {
        pairs.push(`- Run ${i + 1}: not compared, a run did not finish.`);
        continue;
      }
      const got = actualDifference(ra.signatures, rb.signatures);
      const same = JSON.stringify(got) === JSON.stringify(want);
      if (same) ok++;
      pairs.push(`- Run ${i + 1}: ${same ? "✓" : "✗"} the outputs differ in ${got.length ? got.join(", ") : "nothing"}.`);
    }
    out.push(`| B vs A | Same meeting, one agreement changed | Outputs differ in exactly: ${want.join(", ")} | ${ok} of ${Math.min(a.runs.length, b.runs.length)} pairs | |`);
  }
  out.push("", `**${allRuns.filter(passed).length} of ${allRuns.length} runs passed.**`, "");
  if (pairs.length > 0) out.push("B vs A, run 1 of A against run 1 of B and so on:", "", ...pairs, "");

  out.push(
    "## Time and cost per recording",
    "",
    "Median times and mean cost over the runs that finished. Transcript: time to the transcript (speech to text). List: time to the list (speech to text plus extraction, with its retry if the checks asked for one), with the fastest and slowest run in brackets. Times are measured around the server functions, so the upload from the browser is not included. Cost is at list prices (lib/pricing.ts), even though the demo runs on free credit and the free tier. Per audio minute: the total cost divided by the length of the recording.",
    "",
    "| Sample | Audio | Transcript | List | Model calls | Input tokens | Output tokens | Speech to text cost | Model cost | Total cost | Per audio minute |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const s of samples) {
    const done = s.runs.flatMap((r) => (r.output ? [r.output] : []));
    const audioMinutes = done[0] ? done[0].stt.metrics.audioSeconds / 60 : 0;
    const total = mean(done.map(runCost));
    const ex = done.flatMap((o) => (o.extraction ? [o.extraction.metrics] : []));
    const toList = done.flatMap((o) => (o.extraction ? [o.stt.metrics.sttSeconds + o.extraction.metrics.extractSeconds] : []));
    out.push(
      `| ${s.name} | ${done[0] ? formatTime(done[0].stt.metrics.audioSeconds) : "-"} | ${seconds(median(done.map((o) => o.stt.metrics.sttSeconds)))} | ${seconds(median(toList))}${toList.length > 1 ? ` (${Math.min(...toList).toFixed(1)} to ${seconds(Math.max(...toList))})` : ""} | ${ex.length ? mean(ex.map((m) => m.calls)).toFixed(1) : "-"} | ${whole(mean(ex.map((m) => m.inputTokens)))} | ${whole(mean(ex.map((m) => m.outputTokens)))} | ${usd(mean(done.map((o) => o.stt.metrics.sttCostUsd)))} | ${usd(mean(ex.map((m) => m.llmCostUsd)))} | ${usd(total)} | ${audioMinutes > 0 ? usd(total / audioMinutes) : "-"} |`,
    );
  }
  const calls = extractions.reduce((n, x) => n + x.metrics.calls, 0);
  const retries = extractions.reduce((n, x) => n + x.metrics.retries, 0);
  // Hosting is separate: Vercel Pro rates for the two requests of one recording that gets a list.
  const requestSeconds = median(outputs.flatMap((o) => (o.extraction ? [o.stt.metrics.sttSeconds + o.extraction.metrics.extractSeconds] : [])));
  const hosting = hostingCostUsd(requestSeconds);
  out.push(
    "",
    `Hosting, separate from the cost above (${HOSTING_PRICE.plan}, ${HOSTING_PRICE.memoryGb} GB functions, lib/pricing.ts): for the median request time of a recording that gets a list, ${seconds(requestSeconds)}, provisioned memory costs ${usd(hosting.memory)} and the two invocations ${usd(hosting.invocations)}. Active CPU is at most ${usd(hosting.cpuAtMost)}, since the functions mostly wait on Deepgram and Gemini, which is not billed as CPU. The plan itself is $${HOSTING_PRICE.planUsdPerSeatMonth} per seat per month.`,
    "",
    `This eval: ${outputs.length} finished runs, ${calls} model calls (${retries} of them retries after the checks), ${usd(outputs.reduce((n, o) => n + runCost(o), 0))} at list prices.`,
    "",
    "## Failed checks",
    "",
  );
  const failing = samples.flatMap((s) => s.runs.filter((r) => !passed(r)).map((r) => ({ s, r })));
  if (failing.length === 0) out.push("None.", "");
  for (const { s, r } of failing) {
    out.push(`### ${s.name}, run ${r.run}`, "");
    for (const c of r.checks.filter((check) => check.status === "fail")) out.push(`- ${c.name}: ${c.detail ?? "failed"}`);
    out.push("");
  }

  const retried = samples.flatMap((s) => s.runs.flatMap((r) => r.retried.map((e) => `- ${s.name}, run ${r.run}: ${e}`)));
  out.push("## Errors retried", "", ...(retried.length ? retried : ["None."]), "");

  out.push("## Checks per sample", "", '✓ passed, ✗ failed, "skip" not checked because the check it depends on failed.', "");
  for (const s of samples) {
    const rows = [...new Set(s.runs.flatMap((r) => r.checks.map((c) => c.name)))];
    out.push(`### ${s.name}: ${s.manifest.title}`, "", `| Check | ${s.runs.map((r) => `Run ${r.run}`).join(" | ")} |`, `|---|${s.runs.map(() => "---|").join("")}`);
    for (const row of rows) {
      const marks = s.runs.map((r) => {
        const c = r.checks.find((check) => check.name === row);
        return !c ? (r.output ? "-" : "error") : c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "skip";
      });
      out.push(`| ${cell(row)} | ${marks.join(" | ")} |`);
    }
    out.push("");
  }
  return out.join("\n");
}

main().catch((e) => {
  console.error(describe(e));
  process.exit(1);
});
