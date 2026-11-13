// Dev only. Turns samples/scripts/<name>.txt into public/samples/<name>.mp3 and
// samples/manifests/<name>.json (true speaker, start and end of every line, plus TTS cost).
//
// Script format:
//   # title: <text>
//   # voice: <SPEAKER> <deepgram aura-2 voice id>
//   <line number> | <SPEAKER> | <text>
// or a script made of other samples or of silence:
//   # concat: A B
//   # silence: <seconds>
//
// One Deepgram TTS request per line, joined with short pauses. Clips are cached in
// samples/.tts-cache by voice and text, so unchanged lines (for example A vs B) are paid once.
// Run: npm run samples:generate  (needs DEEPGRAM_API_KEY in .env.local)

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { Mp3Encoder } from "@breezystack/lamejs";
import { TTS_PRICE, ttsCostUsd } from "../lib/pricing";

const SCRIPTS_DIR = "samples/scripts";
const MANIFEST_DIR = "samples/manifests";
const AUDIO_DIR = "public/samples";
const CACHE_DIR = "samples/.tts-cache";

const SAMPLE_RATE = 24000; // Hz, mono, 16-bit PCM from Deepgram
const GAP_SEC = 0.6; // pause between lines
const EDGE_SEC = 0.5; // silence at the start and end of each file
const MP3_KBPS = 64;

type Script = {
  name: string;
  title: string;
  voices: Record<string, string>;
  lines: { line: number; speaker: string; text: string }[];
  concat: string[];
  silenceSec: number | null;
};

type ManifestLine = { line: string; speaker: string; start: number; end: number; text: string };

type Rendered = { pcm: Int16Array; lines: ManifestLine[]; characters: number };

function parseScript(name: string, source: string): Script {
  const script: Script = { name, title: "", voices: {}, lines: [], concat: [], silenceSec: null };
  for (const raw of source.split("\n")) {
    const row = raw.trim();
    if (!row) continue;
    const directive = row.match(/^#\s*(\w+):\s*(.*)$/);
    if (directive) {
      const [, key, value] = directive;
      if (key === "title") script.title = value;
      else if (key === "voice") {
        const [speaker, voice] = value.split(/\s+/);
        script.voices[speaker] = voice;
      } else if (key === "concat") script.concat = value.split(/\s+/);
      else if (key === "silence") script.silenceSec = Number(value);
      else throw new Error(`${name}: unknown directive "${key}"`);
      continue;
    }
    const parts = row.split("|").map((p) => p.trim());
    if (parts.length !== 3) throw new Error(`${name}: cannot parse line "${row}"`);
    const [num, speaker, text] = parts;
    if (!script.voices[speaker]) throw new Error(`${name}: no voice for speaker ${speaker}`);
    script.lines.push({ line: Number(num), speaker, text });
  }
  return script;
}

function silence(seconds: number): Int16Array {
  return new Int16Array(Math.round(seconds * SAMPLE_RATE));
}

function joinPcm(parts: Int16Array[]): Int16Array {
  const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

let charactersSentThisRun = 0;

async function speak(voice: string, text: string): Promise<Int16Array> {
  const key = createHash("sha256").update(`${voice}\n${text}`).digest("hex").slice(0, 16);
  const cachePath = `${CACHE_DIR}/${key}.pcm`;
  if (!existsSync(cachePath)) {
    const url = `https://api.deepgram.com/v1/speak?model=${voice}&encoding=linear16&sample_rate=${SAMPLE_RATE}&container=none`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`Deepgram TTS ${res.status}: ${await res.text()}`);
    writeFileSync(cachePath, Buffer.from(await res.arrayBuffer()));
    charactersSentThisRun += text.length;
  }
  const bytes = readFileSync(cachePath);
  // Copy into a fresh buffer so the Int16Array view is aligned.
  return new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

async function render(script: Script, rendered: Map<string, Rendered>): Promise<Rendered> {
  if (script.silenceSec !== null) {
    return { pcm: silence(script.silenceSec), lines: [], characters: 0 };
  }

  const parts: Int16Array[] = [];
  const lines: ManifestLine[] = [];
  let characters = 0;
  let cursor = 0; // in samples

  if (script.concat.length > 0) {
    // Join already rendered samples back to back. Each keeps its own edge silence.
    for (const name of script.concat) {
      const part = rendered.get(name);
      if (!part) throw new Error(`${script.name}: concat source ${name} is not rendered`);
      const offsetSec = cursor / SAMPLE_RATE;
      for (const l of part.lines) {
        lines.push({ ...l, line: `${name}:${l.line}`, start: round(l.start + offsetSec), end: round(l.end + offsetSec) });
      }
      parts.push(part.pcm);
      cursor += part.pcm.length;
      characters += part.characters;
    }
    return { pcm: joinPcm(parts), lines, characters };
  }

  const add = (pcm: Int16Array) => {
    parts.push(pcm);
    cursor += pcm.length;
  };
  add(silence(EDGE_SEC));
  for (const [i, l] of script.lines.entries()) {
    if (i > 0) add(silence(GAP_SEC));
    const clip = await speak(script.voices[l.speaker], l.text);
    const start = cursor / SAMPLE_RATE;
    add(clip);
    lines.push({ line: String(l.line), speaker: l.speaker, start: round(start), end: round(cursor / SAMPLE_RATE), text: l.text });
    characters += l.text.length;
  }
  add(silence(EDGE_SEC));
  return { pcm: joinPcm(parts), lines, characters };
}

function encodeMp3(pcm: Int16Array): Buffer {
  const encoder = new Mp3Encoder(1, SAMPLE_RATE, MP3_KBPS);
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < pcm.length; i += 1152) {
    chunks.push(encoder.encodeBuffer(pcm.subarray(i, i + 1152)));
  }
  chunks.push(encoder.flush());
  return Buffer.concat(chunks);
}

function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

async function main() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // Fall back to variables already in the environment.
  }
  if (!process.env.DEEPGRAM_API_KEY) throw new Error("DEEPGRAM_API_KEY is not set (put it in .env.local)");
  for (const dir of [MANIFEST_DIR, AUDIO_DIR, CACHE_DIR]) mkdirSync(dir, { recursive: true });

  const scripts = readdirSync(SCRIPTS_DIR)
    .filter((f) => f.endsWith(".txt"))
    .map((f) => parseScript(f.replace(/\.txt$/, ""), readFileSync(`${SCRIPTS_DIR}/${f}`, "utf8")))
    // Plain scripts first, so concat scripts can reuse their rendered audio.
    .sort((a, b) => Number(a.concat.length > 0) - Number(b.concat.length > 0) || a.name.localeCompare(b.name));

  const rendered = new Map<string, Rendered>();
  for (const script of scripts) {
    const result = await render(script, rendered);
    rendered.set(script.name, result);

    const mp3 = encodeMp3(result.pcm);
    writeFileSync(`${AUDIO_DIR}/${script.name}.mp3`, mp3);
    const durationSec = round(result.pcm.length / SAMPLE_RATE);
    const manifest = {
      sample: script.name,
      title: script.title,
      audio: `${AUDIO_DIR}/${script.name}.mp3`,
      durationSec,
      sizeBytes: mp3.length,
      encoding: `mp3 ${MP3_KBPS} kbps mono ${SAMPLE_RATE} Hz (lamejs)`,
      timingNote:
        "start and end come from PCM sample counts. The MP3 encoder adds a short delay (about 0.05 s) at the start, so decoded times can be slightly later.",
      voices: script.voices,
      lines: result.lines,
      tts: {
        model: TTS_PRICE.model,
        characters: result.characters,
        usdPer1kCharacters: TTS_PRICE.usdPer1kCharacters,
        // Cost to generate this sample from scratch at list price. Concat samples reuse clips, so they cost 0.
        costUsd: script.concat.length > 0 ? 0 : round6(ttsCostUsd(result.characters)),
        priceSource: TTS_PRICE.source,
        priceRetrieved: TTS_PRICE.retrieved,
      },
    };
    writeFileSync(`${MANIFEST_DIR}/${script.name}.json`, JSON.stringify(manifest, null, 2) + "\n");
    console.log(
      `${script.name}: ${durationSec.toFixed(1)} s, ${(mp3.length / 1e6).toFixed(2)} MB, ${result.lines.length} lines, ` +
        `${result.characters} chars, list cost $${manifest.tts.costUsd.toFixed(4)}`,
    );
  }
  console.log(
    `TTS characters sent this run: ${charactersSentThisRun} (cache hits are free), cost this run $${ttsCostUsd(charactersSentThisRun).toFixed(4)}`,
  );
}

function round6(usd: number): number {
  return Math.round(usd * 1e6) / 1e6;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
