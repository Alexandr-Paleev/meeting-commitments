# Meeting commitments

Upload a short English recording of two people planning work and get the final agreed tasks with
owner and deadline, the proposals that did not become commitments, the questions still open and
the items that need clarification. Every value carries a verbatim quote with speaker, timestamp
and a play button for just that sentence.

How it works, results, cost and decisions: `NOTES.md`. Eval results: `eval/report.md`.

## Run it locally

Needs Node.js 22 or later, a Deepgram API key and a Gemini API key.

```bash
npm ci
cp .env.example .env.local
```

Fill in `.env.local`:

- `DEEPGRAM_API_KEY`: from the Deepgram console (speech to text).
- `GEMINI_API_KEY`: free from Google AI Studio, https://aistudio.google.com/apikey
- `TRANSCRIPT_SIGNING_SECRET`: any random value, for example the output of `openssl rand -hex 32`.

Then `npm run dev` and open http://localhost:3000. The sample buttons on the page load the six
test recordings from `public/samples/` and send them through the same steps as an upload.

Keys are read only on the server. `.env.local` is ignored by git.

## Checks

```bash
npm run lint
npm run typecheck
npm test          # unit tests, no network and no keys needed
```

## Eval

```bash
npm run eval                     # every sample 3 times; writes eval/report.md and eval/runs.json
npm run eval -- --runs 1 A C     # fewer runs or samples
npm run eval -- --saved          # check the saved outputs again, no API calls
EXTRACT_THINKING_LEVEL=medium npm run eval -- --out eval/medium   # another setting, own folder
```

The eval calls Deepgram and Gemini with the keys in `.env.local`, so it spends Deepgram credit and
Gemini quota; each report states what its runs cost at list prices. The expected results and the
check rules are in `samples/`.

`npm run samples:generate` voices the sample scripts again with Deepgram Aura-2. It is not needed:
the audio is committed.

## Deploy to Vercel

1. Import the repository in Vercel. The defaults for Next.js work as they are.
2. Set the environment variables `DEEPGRAM_API_KEY`, `GEMINI_API_KEY` and a new
   `TRANSCRIPT_SIGNING_SECRET` (do not reuse the local one).
3. Deploy. `/api/extract` may run up to 300 s (`maxDuration` in its route file).

## Settings

All optional, with defaults in `lib/config.ts`:

| Variable | Default | What it does |
|---|---|---|
| `EXTRACT_MODEL` | `gemini-3.5-flash-lite` | Gemini model for extraction; it needs a price in `lib/pricing.ts` |
| `EXTRACT_THINKING_LEVEL` | `high` | `minimal`, `low`, `medium` or `high` |
| `GEMINI_PAID_TIER` | `false` | `true` only with a paid Gemini key: lifts the block for the EEA, Switzerland and the UK |
| `STT_MODEL` | `nova-3` | Deepgram model |
| `RATE_LIMIT_PER_IP_PER_HOUR` | `20` | Requests per address per hour; one recording makes two |
| `DAILY_REQUEST_CAP` | `100` | Requests per day for the whole demo |

The limits are kept in memory per server instance: they stop accidental loops, they are not a
real quota.

## Privacy and limits

- No accounts, no database, and the audio is not stored: it goes to Deepgram and is dropped.
- On Gemini's free tier, Google may use the content to improve its products and human reviewers
  may read it. The page asks people not to upload real meetings.
- Google's terms allow only the paid tier for apps offered in the EEA, Switzerland and the UK, so
  on the free tier visitors from there get status 451 with an explanation
  (`GEMINI_PAID_TIER=true` lifts it).
- Input: English, exactly two speakers who say their names (or address each other by name), up to
  3 minutes and 4 MB.

## Code map

| Path | What it is |
|---|---|
| `app/page.tsx` | The page: upload or sample, the two steps in order, progress and errors |
| `app/results.tsx` | Decline, who is who, the four sections, how the result was made |
| `app/quotes.tsx` | Quotes looked up by segment id, and playback of one segment |
| `app/api/transcribe/route.ts` | Step 1: limits, speech to text, signature |
| `app/api/extract/route.ts` | Step 2: signature check, extraction |
| `lib/transcript.ts` | Deepgram call, sentence segments, input declines |
| `lib/extract.ts` | Gemini call, one retry with the problems found, metrics |
| `lib/prompt.ts` | The instructions for the model |
| `lib/schema.ts` | The output format, sent to Gemini as a JSON schema |
| `lib/verify.ts` | Checks without a model, and what happens to items that fail them |
| `lib/sign.ts` | HMAC that ties the transcript to this server between the two steps |
| `lib/limits.ts` | Rate limit, daily cap, region block |
| `lib/pricing.ts` | Every price used, with its source and date |
| `lib/config.ts`, `lib/format.ts` | Settings from env; time formatting for server and browser |
| `scripts/eval.ts`, `scripts/eval-checks.ts` | The eval and its checks |
| `scripts/generate-samples.ts` | Voices the sample scripts |
| `samples/` | Scripts, manifests with true line times, expected results, check rules |
| `eval/` | Generated eval reports and every output behind them |
| `tests/` | Unit tests |
