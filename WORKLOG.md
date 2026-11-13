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
