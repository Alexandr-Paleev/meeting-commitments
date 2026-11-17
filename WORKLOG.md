# Work log

One entry per work step: what was done, what went wrong, and every case where model output was
wrong and how it was caught.

## 2026-11-12 to 2026-11-13 - Phase 0: plan

- Done: checked current official docs and pricing for speech to text (Deepgram, AssemblyAI, OpenAI),
  Claude (models, structured outputs, adaptive thinking, refusal fallbacks), Deepgram TTS and Vercel
  limits. Chose Deepgram Nova-3 for STT, Claude Opus 5.5 for extraction, Deepgram Aura-2 for sample
  TTS. Verified limits: Vercel request body 4.5 MB, so the app accepts at most 4,000,000 bytes of
  audio as the raw request body; 180 s duration.
- Plan approved by the user with these changes: ESLint with the standard Next.js config, fallback
  and HMAC code each under about 30 lines with a comment on why, report extraction latency and
  propose a lower effort if it is above about 20 s, minimal decline samples D, E, F.
- Went wrong: one Deepgram docs page (TTS REST guide) returned no parameter details; used the API
  reference page instead.
- Model output checked: the pricing table was read from the official page; the fallback model cache
  rates (Opus 5 and Opus 4.8) were re-checked against the saved page before writing
  `lib/pricing.ts`, since they were not in the first summary.

## 2026-11-13 - Phase 1: scaffold and test set

- Done: Next.js 16.4.6 scaffold written by hand (config files copied from a reference
  `create-next-app@16.4.6` run, minus fonts and demo assets), exact version pins and a committed
  lockfile, ESLint 9 with `eslint-config-next`, Vitest, `lib/pricing.ts` with sources and dates,
  `CLAUDE.md` project rules, sample scripts A to F, `scripts/generate-samples.ts`, expected file
  template and field guide in `samples/README.md`.
- Went wrong: `npm audit` reports a moderate advisory in `minimatch` pulled in by
  `typescript-eslint` through `eslint-config-next` 16. It is dev tooling only (not in the server or
  browser bundle) and the suggested fix downgrades to `eslint-config-next` 15, so it is left as is.
- Went wrong: the first version of the concat branch in the generator added edge silence and a gap
  twice around joined samples; caught on reading it back and simplified to joining rendered samples
  back to back.

## 2026-11-17 - Scope decisions before Phase 2

- Done: compared moving extraction to the Gemini free tier with staying on Claude. Stayed on
  Claude: free-tier content may be used to improve Google products, the free quota would be shared
  by the demo and the eval, and costs are reported at list prices anyway, so the only saving would
  be a few dollars of development spend. Scope cut agreed with the user (CLAUDE.md, decisions from
  2026-11-17): no stretch goals, refusal fallback deferred, Phase 2 code written while the user
  writes the expected files.
- Went wrong: the sample audio is not generated yet because `.env.local` still has placeholder
  keys.

## 2026-11-17 - Phase 2: pipeline and unit tests (code from 06:16)

- Done: `/api/transcribe` (Deepgram Nova-3 with `diarize_model=latest`, `smart_format` and
  `utterances`; our own split into sentence segments; declines for too long, no speech and not
  two speakers; HMAC signature) and `/api/extract` (Claude Opus 5.5, effort from env, structured
  output from the Zod schema, checks in `lib/verify.ts`, one retry with the problems described,
  items that still fail moved to Needs clarification). Per-IP and daily limits, cost functions,
  40 unit tests with a fake SDK. No live API call yet and no run on the samples: the expected
  files are not committed yet.
- Docs checked: Deepgram pre-recorded API reference and guides (`diarize` is deprecated in favor
  of `diarize_model`; `punctuated_word` is documented only under `utterances`; raw audio is sent
  with its own Content-Type), Claude structured outputs (array `minItems` only 0 or 1, no numeric
  or string constraints; type arrays such as `["string","null"]` are not confirmed, so every
  nullable value in the schema is a whole object), Vercel max duration (300 s default and Hobby
  maximum with fluid compute) and request headers (Vercel overwrites `x-forwarded-for` with the
  client IP).
- Model output wrong, caught: the first `lib/schema.ts` reused one Zod evidence schema and gave
  it a different `.describe()` per field. The generated JSON schema emitted it once as a `$ref`
  with only the generic description, so the model would never see what to cite for speaker
  names, commitments and date context. Caught by printing the schema the SDK sends; fixed with a
  new schema per field.
- Model output wrong, caught: a test helper's type rejected a word without `punctuated_word`.
  Vitest passed because it does not typecheck; `npm run typecheck` caught it.

## 2026-11-17 - Sample audio generated

- Done: the user set `DEEPGRAM_API_KEY` (a Deepgram key with the default permissions: speech to
  text and text to speech, no project changes). `npm run samples:generate` wrote A to F to
  `public/samples/` and `samples/manifests/`. Durations: A 150.7 s, B 149.6 s, C 101.4 s,
  D 26.5 s, E 10.0 s, F 300.3 s, so A to E are under the 180 s limit and F is over it. Every
  file is under 4 MB; F is 2.4 MB, so it reaches the server and is declined there by duration.
- Checked: every MP3 decodes with macOS `afinfo`, and the decoded durations match the manifests
  within 0.06 s (encoder delay, noted in each manifest). In F, B's lines start right after A ends.
- TTS spend: the second run sent 1,679 characters ($0.05 at list price); the first run had
  already sent A's 1,938 characters before it crashed. Paid from the Deepgram free credit, but
  reported at list price.
- Model output wrong, caught: the generator (written in Phase 1, never run before because there
  was no key) passed lamejs output straight to `Buffer.concat`. lamejs is typed as returning
  `Uint8Array` but returns `Int8Array` at runtime, so typecheck passed and the first real run
  crashed after the TTS calls. Fixed by wrapping each chunk as a Buffer over the same bytes. The
  clips were already cached, so the rerun did not pay for them again.
