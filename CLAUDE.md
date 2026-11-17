# Project rules: meeting-commitments

A hiring take-home. A one-page Next.js app: the user uploads a short English recording of two people
planning work, and gets back the final agreed tasks (with owner and deadline), unresolved questions,
not-commitments and items that need clarification. Every field carries a verbatim quote with speaker,
timestamp and a play button for just that segment.

The owner of this repo must understand every file and may be asked to change something live.
Keep the code small (readable in about 30 minutes), explicit and free of abstractions for
hypothetical needs.

## Process

- Phases with an explicit OK from the user at each gate: 0 plan, 1 scaffold and samples, then the
  user commits the expected files, 2 pipeline and unit tests, 3 UI, 4 eval, report and NOTES,
  5 README and final check. Never deploy and never push.
- Small commits after each working step, with clear messages. Never add a Co-Authored-By trailer or
  any other AI attribution line to commit messages (the user's rule since 2026-11-17).
- Append an entry to WORKLOG.md for each work step: what was done, what went wrong, and every case
  where model output was wrong and how it was caught.
- The assignment brief text is never committed. Docs describe the product in our own words.
- Plain hyphens only in docs, UI text and commit messages. No em or en dashes.
- Before using any API parameter, model id, limit or price, check the official docs. Next.js 16 docs
  ship in `node_modules/next/dist/docs/`.
- Before each commit: `npm run lint`, `npm run typecheck`, `npm test` are clean.

## Test set

- `samples/*.expected.json`: at the user's request (2026-11-17) Claude drafted them from the scripts,
  before any pipeline run on a sample, and the user reviews them before they are committed. After
  that commit, never edit them, and never derive them from model output. If one looks wrong, say so
  to the user.
- No special-casing of sample files anywhere. Bundled samples go through the same pipeline as uploads.
- If the eval fails, fix the cause generally and log it in WORKLOG.md. Never tune the prompt to sample
  wording, never weaken a check to get a pass. An honest failure beats a perfect-looking report.
- Numbers in docs come from the generated eval report, never typed by hand.

## Output sections

- Final commitments: agreed (a request plus acceptance, or a stated decision) or a self-commitment,
  and still active at the end. A decision with no action is not listed.
- Not commitments: proposals that were rejected, deferred or never answered, and cancelled tasks,
  each with a reason.
- Unresolved questions: still open at the end. If someone takes on finding the answer, it is a task.
- Needs clarification: the recording supports more than one reading (two candidate deadlines,
  disputed owner, unclear acceptance). The whole item moves here with a specific question and the
  candidate values with evidence. An unsettled item never appears as agreed.

## Correctness rules

1. Final state only. A later correction replaces the earlier value (kept as history). A cancelled
   task is never active.
2. Only accepted proposals or stated decisions become commitments. "We could", "maybe",
   "let's think about it" do not.
3. Owner only if the recording assigns one: a self-commitment (resolved through the speaker label)
   or an explicitly named person. Otherwise owner is null, shown as "No owner agreed". Never guess the
   owner from who raised the topic.
4. Deadline only if agreed, in its original wording. Resolve to a calendar date only when the
   recording states the date context, citing it. Otherwise relative wording gets
   needsDateContext = true. No year is added unless one is stated.
5. Ambiguous items go to Needs clarification; never pick one reading.
6. Input-level decline with a clear reason, and no list: no speech, not exactly two speakers,
   speakers not identifiable by name, longer than 3 minutes, unintelligible.
7. Every input, including the bundled samples, goes through the same pipeline.

## Architecture

- Next.js App Router, TypeScript strict, deployable to Vercel. No accounts, no database, no audio
  stored server side. Keys server side only.
- Two routes called in sequence by the client: `/api/transcribe` (Deepgram, diarization, word
  timestamps, our own re-split into sentence-sized segments) then `/api/extract` (Gemini, structured
  output validated with Zod). The transcript is shown before extraction starts.
- The model sees numbered segments and returns evidence as segment ids only. Code resolves quotes
  and timestamps from ids, so quotes cannot be invented. Transcript text is untrusted data.
- One file each: `lib/prompt.ts`, `lib/schema.ts`, `lib/verify.ts`, `lib/pricing.ts`.
  The model id and the thinking level come from env.
- `lib/verify.ts` runs deterministic checks after the model call. One retry with the violations
  described; anything still failing moves to Needs clarification. Retries are counted in metrics.
- The transcript HMAC and the region block are each under about 30 lines, with a comment saying
  why they exist.
- Hard input limits, a best-effort per-IP rate limit and a daily cap from env (in memory, per
  instance, documented as best effort).

## Decisions from Phase 0 (2026-11-13)

- STT: Deepgram Nova-3 pre-recorded. Extraction: Claude Opus 5.5 by default, effort `high`, both
  from env. TTS for samples: Deepgram Aura-2. MP3 encoding with `@breezystack/lamejs` (dev only).
  No paid intermediary.
- Limits: audio at most 4,000,000 bytes (raw request body under Vercel's 4.5 MB limit) and
  180 s (plus 0.5 s tolerance), checked in the browser and again on the server.
- Stricter verification on top of the base checks: (a) speaker mapping evidence is spoken by that
  label and contains the name, names differ (extended on 2026-11-17, see below); (b) owner evidence includes a segment spoken by the
  owner or naming the owner; (c) relative deadline wording without a resolved date must have
  needsDateContext = true.
- Samples: A (all required cases), B (A with exactly one agreement changed), C (key agreement stays
  ambiguous), D (names never said), E (silence), F (A and B joined, too long).
- If extraction takes more than about 20 s, tell the user and propose a lower effort before the eval.
- Hosting cost is reported at Vercel Pro prices, separate from variable cost.
- Stretch goals only after the eval is green: microphone input, a holdout written by the user after
  the pipeline is frozen, a cheaper extraction model with pass rate vs cost.

## Decisions from 2026-11-17 (scope cut to finish on time)

- Stretch goals are dropped.
- The morning plan to stay on Claude Opus 5.5 (and to defer its refusal fallback) was replaced the
  same day by the provider switch below.
- Phase 2 code is written while the user writes the expected files. No pipeline run on a sample
  before its expected file is committed.
- Deepgram: diarization through `diarize_model=latest` (`diarize` is deprecated); words are read
  from `utterances`, the documented place for `punctuated_word`.
- Deepgram formatting: `punctuate=true`, not `smart_format`. On a clip voiced from the unit-test
  fixture, smart_format rewrote "the first of March twenty twenty seven" as "03/01/2027" (not
  verbatim, and read as 3 January in Europe), and `numerals` split the year into "20 27". Numbers
  therefore stay in words; the checks accept ordinal dates and years said in words.

## Decisions from 2026-11-17 (provider switch)

- Extraction runs on the Gemini API free tier: `gemini-3.5-flash-lite` by default, thinking level
  `high`, both from env. SDK `@google/genai` pinned to 2.32.0 (the 3.x line was 11 days old).
  Reason: the user does not want to pay for API credits. A Claude subscription does not pay for
  API keys, and the brief allows free credits as long as costs are reported at list price, so
  `lib/pricing.ts` keeps the paid tier prices.
- Free tier terms shape the product. Google may use the content to improve its products and human
  reviewers may read it: the UI warns not to upload real meetings, and the notes say so. Apps on
  the free tier may not be offered to users in the EEA, Switzerland or the UK: both routes refuse
  them with status 451 (Vercel's `x-vercel-ip-country`) unless `GEMINI_PAID_TIER=true`.
- The default model was chosen by latency. On the 10-segment unit-test fixture, free tier:
  gemini-4-hydrogen 133 s (high) and 88 s (low), gemini-3.8-flash 294 s (medium),
  gemini-3.5-flash-lite 2.7 s (low) and 15 s (high). A real recording is 3 to 4 times longer and a
  retry doubles the time, so the larger models would hit Vercel's 300 s limit. Whether
  flash-lite's quality is enough is decided by the eval, reported honestly either way.
- The free quota is shared by the demo and the eval.
- No refusal fallback (it was a Claude feature). An answer that does not finish with STOP is an
  error shown to the user.

## Decisions from 2026-11-17 (first sample runs)

- Speaker names, changing rule (a) with the user's OK: a name is also confirmed when the other
  speaker addresses that speaker by it, with the name opening the sentence before a comma or
  closing it after a comma ("Anna, can you...?", "Thanks, Anna."). An address never counts as the
  speaker's own name. Reason: on sample C, Deepgram gave the short "I'm Kevin." to the other label,
  so Kevin's label never said his name.
- The same input can give different answers from run to run (seen on A), so the eval runs each
  sample more than once and reports pass rates.
