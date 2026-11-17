# Delivery notes

Meeting commitments: upload a short English recording of two people planning work and get the
final agreed tasks with owner and deadline, the proposals that did not become commitments, the
questions still open and the items that need clarification. Every value carries a verbatim quote
with speaker, timestamp and a play button for just that sentence.

- Demo: TODO(user) link
- Video (3 minutes): TODO(user) link
- Setup and how to run everything: `README.md`

## How it works

1. The browser checks size (4 MB) and duration (3 minutes), then uploads the audio to
   `/api/transcribe`. Deepgram Nova-3 transcribes it with speaker labels, and the server splits the
   words into sentence segments. Silence, a count other than two speakers and audio over 3 minutes
   are declined here. The transcript appears on the page right away.
2. The browser sends that transcript, signed by the server, to `/api/extract`. Gemini returns
   structured JSON in which every value cites segment ids, never quoted text. Code turns the ids
   into quotes, speakers and times, so a quote cannot be invented.
3. `lib/verify.ts` checks the answer without a model: each speaker name is said by that speaker or
   used by the other one to address them; an owner is supported by a quote spoken by or naming
   them; a deadline appears word for word in its quote; relative wording is flagged unless the
   recording states the date; a year is never added unless said. Problems go back to the model
   once. Anything still failing moves to Needs clarification, so an unsupported item is never
   shown as agreed, and unconfirmed speaker names turn into a decline.

## Expected vs actual

Six recordings voiced from scripts (`samples/scripts/`), each run 3 times through the same functions
the app uses. The expected results were fixed before any run: Claude drafted them from the
scripts at my request, I reviewed and committed them, and they were never changed. The eval
(`npm run eval`) checks sections, owners, deadlines, flags, earlier values and kinds, the time of
every quote against the true line times, and the speaker shown with every quote.

| Sample | What it tests | Expected | First eval | Final |
|---|---|---|---|---|
| A | Every required case | Release notes (Daniel, by Tuesday, earlier by Wednesday); pricing page (no owner, before Friday); launch email (Emma, by Thursday); banners cancelled; webinar deferred; legal terms an open question | 3 of 3 | 2 of 3 |
| B | A with one agreement changed | As A, but the banners stay agreed (Emma, this week) | 0 of 3 | 1 of 3 |
| B vs A | Only the changed agreement differs | Only the banners differ | 2 of 3 pairs | 3 of 3 pairs |
| C | An agreement that stays ambiguous; a deadline resolved from a date said in the recording | Agenda (Laura, by Friday = March 7); training room (Kevin, no deadline); live demo needs clarification (who runs it: Kevin or Sam); lunch rejected; two open questions | 0 of 3 | 3 of 3 |
| D | Speakers never say their names | Decline | 3 of 3 | 3 of 3 |
| E | Ten seconds of silence | Decline | 3 of 3 | 3 of 3 |
| F | Five minutes, over the limit | Decline | 3 of 3 | 3 of 3 |
| All | | | 12 of 18 runs | 15 of 18 runs |

Reports: `eval/baseline/report.md` (first eval), `eval/report.md` (final), `eval/medium/report.md`
(the same as final, with thinking level `medium`). In the app, F is refused in the browser before
upload; the eval checks the server's own refusal.

## What failed

- Speaker labels, in all 3 failed runs of the final eval. Speech to text gives Daniel's "I honestly
  don't know who should own it, though." to Emma, in both A and B. When the model cites it as
  evidence that the pricing page has no owner, the page shows that quote under the wrong name.
  Every other check passed in all 18 runs. The app cannot notice this, because it never knows who
  really spoke; the eval can, from the script timings. Not fixed (see next steps).
- The live demo in C, in the first eval (0 of 3): the model filed it as a deferred proposal, while
  the recording leaves open only who runs it. I added one general rule to the prompt: deferred
  means the work itself was put off, and an owner or deadline left open between named candidates
  needs clarification. C then passed 3 of 3 ("Who will run the live demo?", Kevin or Sam), and A's
  webinar stayed deferred.
- Before the eval: C was declined at first, because speech to text gave "I'm Kevin." to Laura's
  label, so Kevin's label never said his name. A name now also counts when the other speaker
  addresses that person by it ("Thanks, Kevin."), with a position check in code.
- Run to run variance: single runs lost the pricing page to an open question, wrote an earlier
  deadline as "ready by Wednesday", or missed a question. None of this happened in the final 18
  runs, but 18 runs is a small sample.
- Thinking level `medium`: the list came sooner, but only 10 of 18 runs passed, mostly because the
  pricing page moved to Needs clarification. The default stays `high`.
- What worked as designed: the app's own checks caught model mistakes. In C, answers that resolved
  the date but still flagged it as needing date context went back to the model once and came back
  fixed (once in the final eval, twice in the first).

## Time to a useful result

Medians from `eval/report.md`, on Gemini's free tier, measured around the server functions (the
upload from the browser is not included):

- The transcript is on the page after 2.5 to 4.0 s for recordings of 0:26 to 2:30.
- The list follows after 6.4 s for 0:26 and 18.4 to 39.8 s for 1:41 to 2:30. Single runs of the
  2:30 recording took 15.2 to 56.0 s, while the model's output size changed far less than that
  (`eval/runs.json`), so most of the spread is the free tier's speed.
- Thinking level `medium` gives the list after 12.5 to 18.3 s for the same recordings, at the
  quality cost above.

## Cost per operation

List prices, even though the demo runs on Deepgram's free credit and Gemini's free tier. Every
price is in `lib/pricing.ts` with its source and the date it was read. Numbers are means from
`eval/report.md`.

| Part | Price | Recording A (2:30) |
|---|---|---|
| Recognition: Deepgram Nova-3, diarization included | $0.0043 per audio minute | $0.0108 |
| Reasoning: `gemini-3.5-flash-lite`, thinking `high` | $0.30 per million input tokens, $2.50 per million output tokens; thinking is billed as output | $0.0136 (1,935 tokens in, 5,214 out) |
| Retries | A retry after failed checks is a second model call, included above. The final eval made 13 calls for 12 extractions | |
| Speech | None in the app. Voicing the test set once with Deepgram Aura-2 ($0.030 per 1,000 characters) cost about $0.11 (WORKLOG) | |
| Intermediaries | None: the server calls Deepgram and Gemini directly | |
| Total variable cost | | $0.0244 (B $0.0260, C $0.0238, a decline for silence $0.0007) |

Hosting, separate: on Vercel Pro with 2 GB functions, the median request time of a recording that
gets a list (18.5 s) costs about $0.0001 of provisioned memory and less than $0.0001 for the two
invocations. Active CPU is at most $0.0007, since the functions mostly wait for Deepgram and
Gemini. The plan itself is $20 per seat per month. The final eval (18 runs) cost $0.3073 at list
prices.

## AI tools and models

- Building: Claude Code with Claude Opus 5.5 (`claude-opus-5-5`) wrote the plan, the code, the
  tests, the docs and the sample scripts, working in phases that I approved one by one. It also
  drafted the expected results from the scripts at my request, before any pipeline run on a
  sample; I reviewed and committed them, and they were not changed after that.
- In the product: Deepgram Nova-3 (speech to text with diarization) and Gemini
  `gemini-3.5-flash-lite` with thinking level `high` (extraction), on Gemini's free tier.
- For the test set: Deepgram Aura-2 voices (text to speech).
- Every case where model output was wrong is logged in `WORKLOG.md`. Examples of how it was caught:
  - Claude chose Deepgram's `smart_format` without checking it. The first live call turned "the
    first of March twenty twenty seven" into "03/01/2027": not verbatim, and read as 3 January in
    Europe. Caught by comparing the live transcript with the script; switched to `punctuate` and
    taught the checks to read dates and years in words.
  - Claude's first schema reused one Zod evidence field, so the JSON schema sent to the model kept
    one generic description and the model would not have been told what to cite for speakers or
    date context. Caught by printing the schema the SDK actually sends.
  - On sample C, Deepgram gave "I'm Kevin." to the other speaker, and the input was declined. The
    rule for names was widened, with my OK, to accept a direct address ("Thanks, Kevin."), with a
    position check in code. The eval shows the result before and after.

## Decisions and tradeoffs

- Quotes by segment id, checked by code. The model can be wrong about meaning, but not about what
  was said: every quote on the page is transcript text at its real time.
- Decline instead of guessing. Owners come from names, so a recording where the speakers cannot be
  named gets no list; the same for silence, more than two speakers and long audio.
- When unsure, ask. An item the recording supports in more than one way goes to Needs
  clarification with the candidate readings and their quotes, not to the agreed list.
- Transcript first. The transcript shows after a few seconds while the slower extraction runs.
- Verbatim over pretty. Dates stay in words as spoken, and a relative deadline ("by Friday") is
  flagged as needing date context unless the recording says the date.
- Free tier, so I did not have to pay for an API. Its terms shaped the product: the page warns not
  to upload real meetings (Google may use and review free tier content), and visitors from the
  EEA, Switzerland and the UK get a clear refusal (status 451), because the free tier may not be
  offered there. One environment variable lifts this on a paid key. Costs below are list prices
  anyway.
- Model chosen by latency. Larger Gemini models took 88 to 294 s on a 10-line test on the free
  tier (WORKLOG), too close to Vercel's 300 s limit with a retry, so the default is the fastest
  one. Its quality is what the eval measures.
- No accounts, no database, no stored audio. The transcript travels through the browser with an
  HMAC, so the extraction route only accepts transcripts this server produced.

## Known limits

- Speaker labels come from diarization, which makes mistakes at turn changes, mostly on short
  sentences. A wrong label shows a quote under the wrong speaker; the eval counts every such quote.
- Speech to text can mishear words ("can" for "could"), and the model only sees the transcript.
- The same input can give different answers on different runs, which is why the eval runs every
  sample three times.
- English only, exactly two speakers, names said in the recording, up to 3 minutes and 4 MB.
- Free tier: quota shared by everyone using the demo, occasional 503 "high demand" (retried), no
  service for EEA, Swiss and UK visitors.
- Rate limits live in memory per server instance: enough against accidental loops, not a quota.

## Next steps

- Measure a paid tier and a stronger model with the same eval, to trade latency for quality.
- Use Deepgram's per-word speaker confidence to mark quotes whose speaker is uncertain.
- Run extraction two or three times and keep only what the runs agree on, at two or three times
  the model cost.
- More test recordings: real voices, noise, accents, people talking over each other, and a holdout
  set written after the prompt is frozen.
- Recording from the microphone, and export of the list.

## Reused components

Next.js 16.4.6, React 19.3.1, Zod 4.6.7 (schema and JSON schema), `@google/genai` 2.32.0, the
Deepgram REST API called with `fetch` (no SDK), Vitest 5.1.0, ESLint 9 with `eslint-config-next`,
tsx, and `@breezystack/lamejs` 1.2.7 (only to encode the sample MP3 files). No UI kit.

## Time spent

TODO(user)
