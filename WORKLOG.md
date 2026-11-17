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

## 2026-11-17 - First live speech to text call; formatting changed

- Done: a smoke test of `transcribeAudio` against the real Deepgram API, on a clip voiced from the
  unit-test fixture (not a sample). The parameters were accepted, the response matched our schema,
  every segment had the right speaker, and 32 s of audio took 2.5 to 3.7 s and cost $0.0022.
  Segment times were within 0.35 s of the true line times.
- Model output wrong, caught: the Phase 2 code used `smart_format`, chosen without checking what it
  does to dates. The first live call returned "by the 03/03/2027" for "by the 3rd of March 2027"
  and "the 03/01/2027" for "the first of March 2027": quotes must be verbatim, and "03/01" reads as
  3 January in Europe. Docs checked (smart format, punctuation, numerals, utterances): smart_format
  always formats dates. Compared on the same clip: `punctuate` alone keeps "the third of March
  twenty twenty seven"; `punctuate` plus `numerals` gives "the 3rd of March 20 27" (year split).
  Switched to `punctuate`.
- Follow-up changes: `isCalendarDate` accepts ordinal words ("the third of March"); the resolved
  year check accepts the year said in words ("twenty twenty seven"); a sentence that Deepgram
  splits across two utterances of the same speaker is joined into one segment (the first call split
  "Today" from "is the 03/01/2027."). 43 unit tests pass; the real code path on the clip now gives
  "Today is the first of March twenty twenty seven, so that's soon." as one segment.
- Seen, not changed: on a second TTS rendition of the same text, speech to text heard "We can also
  redo the logo" instead of "We could". Transcription errors happen and the model can only work with
  what the transcript says. Goes into the known limits.
- Sample scripts were not changed and no sample was transcribed: their deadlines are already words
  ("by Wednesday", "by Friday"), so the switch does not change how the expected files are written.

## 2026-11-17 - Extraction moved to the Gemini free tier

- Why: the user does not want to pay for API credits. Checked first on the official pages: a
  Claude Pro or Max subscription does not pay for Console API keys, subscription login may not be
  used in other apps, and only Max, Ultra and Team include monthly API credits. The brief allows
  free credits as long as costs are reported at list price.
- Docs checked: Google AI Studio docs (key creation, available regions, free tier terms, pricing,
  thinking levels) and the installed SDK's type definitions for the exact `generateContent` fields
  (`responseJsonSchema` and its keyword list, `ThinkingLevel`, `FinishReason`, `usageMetadata`:
  `thoughtsTokenCount` is separate from `candidatesTokenCount` and billed as output). Free tier
  terms: content may be used to improve Google products and read by human reviewers; only paid
  services for apps offered to users in the EEA, Switzerland or the UK. Vercel request headers:
  `x-vercel-ip-country` is an ISO 3166-1 alpha-2 code; the page does not say it cannot be spoofed,
  which is acceptable for a good-faith terms check.
- Done: `lib/extract.ts` calls `generateContent` with the system prompt, the JSON schema and the
  thinking level; the retry sends the previous model turn back unchanged (thought signatures
  included). The schema Zod generates was walked key by key: every keyword is in Gemini's supported
  list except `$schema`, which is dropped. Prices (paid tier list prices), config, `.env.example`
  updated; Anthropic SDK removed; both routes refuse EEA, Swiss and UK visitors with 451 on the free
  tier. 45 unit tests with a fake client; lint and typecheck clean. `npm audit --omit=dev`: 0
  findings (7 moderate ones are in dev-only lint tooling).
- Not done yet: no live Gemini call, waiting for the key.

## 2026-11-17 - First live Gemini calls; default model chosen by latency

- Key check: `GEMINI_API_KEY` set by the user in a new project `meeting-commitments` (no billing,
  so free tier). `.env.local` is ignored by git, was never committed, and the key is read only on
  the server (no `NEXT_PUBLIC_` variables).
- Done: live extraction on the unit-test fixture (10 segments, not a sample) with five model and
  thinking level combinations. Every answer passed the checks with no retry.
  - gemini-4-hydrogen, high: 133.5 s, 4,238 output tokens (3,985 thinking), $0.036 at list price
  - gemini-4-hydrogen, low: 88.5 s, 1,096 output tokens, $0.013
  - gemini-3.8-flash, medium: 294.0 s, 3,407 output tokens, $0.014
  - gemini-3.5-flash-lite, low: 2.7 s, 349 output tokens (no thinking), $0.001
  - gemini-3.5-flash-lite, high: 14.8 s, 3,121 output tokens (2,939 thinking), $0.008
- Checked in the SDK source: it retries only when `retryOptions` is passed, and we pass none, so
  the times are the service's own latency on the free tier, not hidden retries.
- Quality on the fixture: all five got the release notes task (owner Lee, deadline Thursday,
  earlier Friday) and the rejected logo. The fixture's "Someone has to update the wiki" line is
  ambiguous: Hydrogen listed it as a task with no owner and resolved both dates from "Today is the
  first of March 2027"; the Flash models listed it as an unanswered proposal or an open question.
  The real test of this case is sample A, where the task is agreed explicitly.
- Decision: default `gemini-3.5-flash-lite` with thinking `high`. A real recording is 3 to 4 times
  longer than the fixture and a retry doubles the time, so the larger models would hit Vercel's
  300 s limit. Proposed to the user; one env variable switches back.
- Tooling: one measurement command was blocked by a built-in safety check that could not parse it
  (there was no removal in it). The same measurement ran as a script file instead.

## 2026-11-17 - Expected files drafted by Claude at the user's request

- The user asked Claude to write the expected files instead of writing them by hand. Done under
  three conditions, recorded in CLAUDE.md and `samples/README.md`: drafted only from the scripts,
  before any pipeline run on a sample (no sample has been transcribed or extracted yet); the user
  reviews them before they are committed; the notes say who wrote them.
- Checked with a read-only script against the scripts: valid JSON, every field present, every line
  exists, each name is said by its own speaker, owner lines are spoken by or name the owner,
  deadline wordings and keywords appear in their lines, the resolved date has date context lines,
  and A and B differ in exactly one item (banners). No problems found.
- Judgment calls left for the user to confirm: A webinar is "deferred" ("Let's think about it"),
  not "rejected"; A pricing page is an agreed task with no owner (not a clarification); A release
  notes end at "by Tuesday" with "by Wednesday" as history; A banners are "cancelled", B banners
  are agreed (owner Emma, "this week"); C agenda "by Friday" resolves to 03-07 from "today is
  Monday, March 3rd" (no year said); C training room has an owner and no deadline; C live demo is a
  clarification; C lunch is "rejected" ("Let's skip that for now"); C has two open questions
  (headcount, inviting their IT team); D, E, F are declines.

## 2026-11-17 - First runs of the real pipeline on the samples; speaker rule extended

- After the expected files were committed (ac29713), ran each sample once through the same lib
  functions the routes use (a scratch script, not committed).
- First runs: A and B match their expected files. D, E and F decline as expected
  (speakers_not_identified, no_speech, too_long). C declined with speakers_not_identified.
- C, what went wrong: Deepgram split Kevin's line "Hi Laura. I'm Kevin, I'm on the sales
  engineering team." across both labels and gave "I'm Kevin." to Laura's label. Kevin's label never
  says his name, so under rule (a) the model's decline was correct. An input error that the rule
  could not absorb, not a model error. Other label errors at turn changes were seen in A, on
  segments that nobody cited.
- Fix, with the user's OK (changes rule (a)): a speaker is also identified when the other speaker
  addresses them by name, with the name opening the sentence before a comma or closing it after a
  comma. `addresses` in lib/verify.ts checks the position, and an address never counts as the
  speaker's own name. The prompt and the schema descriptions say the same, with a neutral example
  name that is not in any sample. D, with no names at all, still declines.
- C after the fix: S0 Laura (segments 2 and 4), S1 Kevin (21 "Kevin, could you run it?" and 48
  "Thanks, Kevin."). Agenda (Laura, by Friday, resolved to 03-07 from "today is Monday, March
  third"), training room (Kevin), lunch rejected and both open questions match. The live demo came
  back as a deferred proposal where the expected file has Needs clarification. Left for the eval.
- A second run of A differed from the first: the pricing page task (agreed, no owner) came back
  only as an open question about its owner. Same input, same prompt for that item, so this is run
  to run variance. The eval will run each sample more than once.
- Gemini's free tier answered 503 "This model is currently experiencing high demand" on two calls
  in a row. The SDK retries only when `retryOptions` is set: now up to 3 attempts with a 2 to 8 s
  backoff on 408 and 5xx, not on 429 (a quota limit). The route passes 429 and 503 on with
  Retry-After 60, so the UI can say "try again in a minute".
- Times per sample: speech to text 3 to 6 s; extraction 8 to 14 s, once 31 s (C, right after the
  503s, so it may include SDK retries, which our metrics cannot see). Cost per recording at list
  price: $0.005 to $0.014.

## 2026-11-17 - UI (phase 3)

- One page. `app/page.tsx` runs the two steps in order and shows the transcript as soon as it
  arrives. `app/results.tsx` shows a decline, or who is who, the four sections and how the result
  was made. `app/quotes.tsx` turns segment ids into quotes and plays just one segment of the
  uploaded file. `formatTime` moved to `lib/format.ts`, shared by the server and the browser.
- Checked in the build output that the browser bundle has no server code: no Gemini or Deepgram
  URL, no secret name and no zod in `.next/static`.
- The browser checks size and duration before uploading, so F is refused without any API call.
  The server checks again.
- Checked in headless Chrome over the DevTools protocol (a scratch script, not committed): sample A
  end to end, with the transcript shown while extraction ran, all six expected items, and the
  first play button stopping at 30.06 s for a target of 30.04 s; F refused in the browser; E
  declined as no speech; phone width 390 px and dark mode on saved answers. No console errors.
- What went wrong: the React Compiler lint rule `react-hooks/immutability` refused setting
  `currentTime` on an audio ref passed into the hook, so the ref now lives in the hook. Several
  runs failed with connect timeouts to api.deepgram.com and to Google from this machine (curl
  showed TCP connects of 4 to 12 s and TLS handshakes up to 19 s). The page showed the error and
  the Try again button as designed.
- Model output: the model sometimes starts a task in lower case; the page capitalizes the first
  letter. A has now run three times: runs 1 and 3 match its expected file, run 2 listed the
  pricing page only as an open question.

## 2026-11-17 - Eval (phase 4): first full run

- Done: `npm run eval` runs every sample 3 times through `transcribeAudio` and `extract` (the
  functions the routes call) and checks each output with `scripts/eval-checks.ts`, by the rules in
  `samples/README.md`. It writes `eval/report.md` and `eval/runs.json`; `--saved` checks the saved
  outputs again without any API call. 7 unit tests cover the checks on a made-up recording. Before
  spending quota, the checks ran on the saved outputs of the first sample runs and found the known
  misses plus one new one (the B speaker error below, also present in that A output).
- Hosting estimate added to `lib/pricing.ts` after checking Vercel's docs: 2 GB is the default
  function size on Pro with fluid compute; memory is billed while the function waits, active CPU
  only while code runs.
- Result: 12 of 18 runs passed. A 3 of 3, B 0 of 3, C 0 of 3, D, E and F 3 of 3; B vs A 2 of 3
  pairs. Numbers and details: `eval/baseline/report.md` (kept as the baseline; `--out` writes
  later runs elsewhere).
- B, all runs: the transcript gives Daniel's "I honestly don't know who should own it, though." to
  Emma's label, and the model cites it for the pricing page (no owner). A speech to text error that
  the app cannot see, since it never knows the true speaker. The same sentence has the wrong label
  in A too, but there the model did not cite it.
- B run 2 also listed the pricing page only as an open question (as A did once before) and wrote
  the earlier deadline as "ready by Wednesday" instead of "by Wednesday".
- C, all runs: the live demo came back as a deferred proposal, not Needs clarification. C run 1
  also missed the headcount question.
- Model output wrong, caught by the app's own checks: in C runs 1 and 2 the first answer resolved
  the date and still set needsDateContext; the retry fixed it both times.
- Time: extraction took 14 to 58 s on the free tier (median 32 s for A), against 12 to 14 s for
  single runs earlier today, with similar output token counts. The spread is the free tier's
  serving speed. Above the 20 s mark from Phase 0, so a lower thinking level goes to the user.
- Went wrong: a shell command with a heredoc was blocked by the safety check because it could not
  be parsed (it removed nothing); the same edit was made with the edit tool.

## 2026-11-17 - Prompt: deferred work against an open owner or deadline; thinking level measured

- Change, with the user's OK after the first eval: the prompt now says that "deferred" means doing
  the work at all was put off, and that work going ahead while its owner or deadline is left open
  between named candidates belongs in Needs clarification. Two sentences, no wording from any
  sample.
- Eval after the change (`eval/report.md`): 15 of 18 runs passed, against 12 before. C 3 of 3
  (was 0): the live demo comes back as Needs clarification with both candidates. A's webinar stays
  deferred in every run. B vs A 3 of 3 pairs.
- The 3 runs that still fail (A run 1, B runs 2 and 3) fail only on speaker labels: the model cites
  "I honestly don't know who should own it, though.", which speech to text gives to the wrong
  speaker (A run 1 also cites a mislabelled "Thank you."). Every other check passed in all 18 runs.
- Thinking level `medium` measured with the same prompt (`eval/medium/report.md`): the list came
  much sooner and cost less, but only 10 of 18 runs passed. The pricing page (agreed, no owner)
  went to Needs clarification in 5 of 6 A and B runs, and C had one wrong kind and one missed
  clarification. The default stays `high`.
- The report table now splits the cost into speech to text and model, and shows the time to the
  transcript and to the list. All three reports were rebuilt from their saved outputs (`--saved`).
- Went wrong: one network error to Deepgram ("other side closed") during the medium run, retried
  by the eval and listed in its report.

