# Test set

| Sample | Script | What it tests |
|---|---|---|
| A | `scripts/A.txt` | Normal input with every required case: an accepted task, a proposal that is never accepted, a deadline corrected by the other speaker, a task cancelled well after it was agreed, an agreed task with no owner, an open question, relative dates with no date context |
| B | `scripts/B.txt` | A with exactly one agreement changed (lines 27 to 29). Every other line is identical, and the identical lines reuse the same audio clips |
| C | `scripts/C.txt` | A key agreement stays ambiguous, so the right output is a clarification question. Also one deadline that can be resolved from a date stated in the recording |
| D | `scripts/D.txt` | Two speakers who never say their names: expected input-level decline |
| E | `scripts/E.txt` | Ten seconds of silence: expected decline (no speech) |
| F | `scripts/F.txt` | A and B joined, longer than three minutes: expected decline (too long), checked on the server |

- Scripts: one line per utterance, `<line> | <SPEAKER> | <text>`. The `# voice:` header picks the
  Deepgram Aura-2 voice per speaker.
- Audio: `public/samples/<name>.mp3` (committed, so nobody needs to regenerate).
- Manifests: `manifests/<name>.json` with the true speaker, start and end (seconds) of every line,
  and the TTS cost of the sample.
- Regenerate: put `DEEPGRAM_API_KEY` in `.env.local`, then `npm run samples:generate`.
- Expected results: `<name>.expected.json`, written by hand from the scripts, committed before any
  pipeline run. Format below.

## Expected file format

Copy `expected.template.json` to `<name>.expected.json` (for example `A.expected.json`) and fill it in.

### Top level

| Field | Meaning |
|---|---|
| `sample` | `"A"`, `"B"`, ... |
| `decline` | `null` if a list should be produced. Otherwise one of `"no_speech"`, `"too_long"`, `"speaker_count"`, `"speakers_not_identified"`, `"unintelligible"` |
| `speakers` | Name as introduced in the recording, mapped to the script line(s) where that speaker says their own name |
| `items` | Every item you expect in the output, in any section |
| `mustNotBeAgreed` | Things that must never appear in Final commitments |

For a decline sample, only `sample` and `decline` are needed, for example
`{ "sample": "D", "decline": "speakers_not_identified" }`.

### Items

| Field | Meaning |
|---|---|
| `id` | Your own short id. Use the same id for the same agreement in A and B: the eval derives the expected B vs A difference from these ids |
| `section` | `"commitment"` (Final commitments), `"not_commitment"`, `"unresolved_question"` or `"clarification"` |
| `keywords` | Words that identify the item. Each entry must appear (case-insensitive) in the item text or its quotes. `"a\|b"` means either. Prefer 1 to 3 words taken from the script |
| `owner` | Commitments only. The owner's name as spoken, or `null` for "No owner agreed" |
| `deadline` | Commitments only. The final agreed deadline wording as spoken (for example `"by Friday"`), or `null` for no agreed deadline. Matched after normalizing case and punctuation, and an extra or missing "by"/"before" prefix is tolerated |
| `needsDateContext` | Commitments with a deadline: `true` if the wording is relative and the recording gives no calendar anchor, else `false`. `null` when there is no deadline |
| `resolvedDate` | Only when the recording states the date context: `"MM-DD"` (or `"YYYY-MM-DD"` if a year is said). Otherwise `null` |
| `deadlineHistory` | Earlier agreed deadline wordings, oldest first, for example `["Wednesday"]`. Empty if never corrected |
| `kind` | Not commitments only: `"rejected"`, `"deferred"`, `"unanswered"` or `"cancelled"`. Otherwise `null` |
| `lines` | Script lines that prove the item exists (the task and its acceptance, the question, the proposal and the reply, the lines that show the ambiguity) |
| `ownerLines` | Lines that prove the owner (empty if `owner` is `null`) |
| `deadlineLines` | Lines that prove the final deadline wording (empty if `deadline` is `null`) |
| `dateContextLines` | Lines that state the date context (empty if `resolvedDate` is `null`) |

Fields that do not apply to a section stay `null` or `[]`, as in the template.

### Must not be agreed

| Field | Meaning |
|---|---|
| `keywords` | If a Final commitment's text or quotes contain all of these, the exclusion check fails |
| `lines` | The script lines where this was proposed, rejected or cancelled (for the report) |
| `why` | Short reason, shown in the report |

### How the eval uses this

- Inclusion: each expected item is found by section and keywords, then owner, deadline, flags,
  history and kind are compared.
- Exclusion: nothing from `mustNotBeAgreed` appears in Final commitments, and no Final commitment
  appears that does not match an expected commitment.
- Evidence: for each non-empty `lines` / `ownerLines` / `deadlineLines` / `dateContextLines`, at
  least one quote cited for that field overlaps the true time range of one of those lines (from the
  manifest, 0.3 s tolerance). Every cited quote must also be attributed to the speaker who really
  said it.
- B vs A: items whose id, section, owner, deadline, flags or kind differ between `A.expected.json`
  and `B.expected.json` are the expected difference. The actual outputs must differ in exactly those
  items.
