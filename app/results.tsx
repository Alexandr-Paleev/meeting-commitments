// What the page shows after each step: a decline, or who is who and the four sections, then how
// the result was made. Every value comes with the quotes that support it.

import { AUDIO_LIMITS } from "@/lib/config";
import type { ExtractResult } from "@/lib/extract";
import { formatTime } from "@/lib/format";
import type { Clarification, Commitment, Extraction } from "@/lib/schema";
import type { Decline, DeclineReason, TranscribeResult } from "@/lib/transcript";
import { Quotes } from "./quotes";

type NotCommitment = Extraction["notCommitments"][number];

const KIND: Record<NotCommitment["kind"], string> = {
  rejected: "Rejected",
  deferred: "Deferred",
  unanswered: "Never answered",
  cancelled: "Cancelled",
};

const DECLINE: Record<DeclineReason, { title: string; fix: string }> = {
  no_speech: { title: "No speech found", fix: "Check that the file has sound, then upload it again." },
  too_long: { title: "The recording is too long", fix: `Upload a recording of ${AUDIO_LIMITS.maxSeconds / 60} minutes or less.` },
  speaker_count: { title: "Not a conversation between two people", fix: "This app works with exactly two speakers." },
  speakers_not_identified: {
    title: "The speakers could not be identified by name",
    fix: "Owners are named from the recording, so each speaker has to say their name or be addressed by it.",
  },
  unintelligible: { title: "The speech could not be understood", fix: "Try a clearer recording." },
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// "03-07" -> "March 7", "2027-03-07" -> "March 7, 2027". No year is shown unless one was said.
function formatDate(date: string): string {
  const m = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}${m[1] ? `, ${m[1]}` : ""}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const usd = (n: number) => `$${n.toFixed(4)}`;

export function DeclineCard({ decline }: { decline: Decline }) {
  const d = DECLINE[decline.reason];
  return (
    <section className="decline" role="status">
      <h2>No list for this recording: {d.title.toLowerCase()}</h2>
      <p>{decline.message}</p>
      <p className="hint">{d.fix}</p>
    </section>
  );
}

function Section(props: { title: string; hint: string; count: number; empty: string; children: React.ReactNode }) {
  return (
    <section className="section">
      <h2>
        {props.title} <span className="count">{props.count}</span>
      </h2>
      <p className="hint">{props.hint}</p>
      {props.count === 0 ? <p className="empty">{props.empty}</p> : props.children}
    </section>
  );
}

// One labelled value and the quotes behind it.
function Field({ label, ids, children }: { label: string; ids?: number[]; children?: React.ReactNode }) {
  return (
    <div className="field">
      <div className="label">{label}</div>
      <div>
        {children && <div className="value">{children}</div>}
        {ids && ids.length > 0 && <Quotes ids={ids} />}
      </div>
    </div>
  );
}

function CommitmentCard({ c }: { c: Commitment }) {
  const d = c.deadline;
  return (
    <article className="card">
      <h3>{c.task}</h3>
      <Field label="Owner" ids={c.owner?.evidence}>
        {c.owner ? c.owner.name : <span className="none">No owner agreed</span>}
      </Field>
      <Field label="Deadline" ids={d?.evidence}>
        {!d && <span className="none">No deadline agreed</span>}
        {d && d.wording}
        {d?.resolvedDate && <> = {formatDate(d.resolvedDate.date)}</>}
        {d?.needsDateContext && <span className="badge warn">relative, the recording gives no date</span>}
      </Field>
      {d?.resolvedDate && <Field label="Date from" ids={d.resolvedDate.evidence} />}
      {c.history.map((h, i) => (
        <Field key={i} label={`Earlier ${h.field}`} ids={h.evidence}>
          <s>{h.previous}</s> <span className="badge">changed later</span>
        </Field>
      ))}
      <Field label="Agreed" ids={c.evidence} />
    </article>
  );
}

function ClarificationCard({ c }: { c: Clarification }) {
  return (
    <article className="card">
      <h3>{c.text}</h3>
      <p className="question">{c.question}</p>
      {c.candidates.map((k, i) => (
        <Field key={i} label={`Reading ${i + 1}`} ids={k.evidence}>
          {k.value}
        </Field>
      ))}
      <Field label="Said" ids={c.evidence} />
    </article>
  );
}

export function Results({ result }: { result: ExtractResult }) {
  return (
    <>
      <section className="section">
        <h2>Who is who</h2>
        <p className="hint">Each name is said by that speaker, or used by the other speaker to address them.</p>
        {result.speakers.map((s) => (
          <Field key={s.label} label={`Speaker S${s.label}`} ids={s.evidence}>
            {s.name}
          </Field>
        ))}
      </section>

      <Section title="Final commitments" hint="Agreed and still active at the end." count={result.commitments.length} empty="Nothing was agreed.">
        {result.commitments.map((c, i) => (
          <CommitmentCard key={i} c={c} />
        ))}
      </Section>

      <Section
        title="Needs clarification"
        hint="The recording supports more than one reading. Settle these before acting on them."
        count={result.clarifications.length}
        empty="Nothing is ambiguous."
      >
        {result.clarifications.map((c, i) => (
          <ClarificationCard key={i} c={c} />
        ))}
      </Section>

      <Section title="Unresolved questions" hint="Still open at the end." count={result.unresolvedQuestions.length} empty="No open questions.">
        {result.unresolvedQuestions.map((q, i) => (
          <article key={i} className="card">
            <h3>{q.question}</h3>
            <Field label="Asked" ids={q.evidence} />
          </article>
        ))}
      </Section>

      <Section
        title="Not commitments"
        hint="Proposed but rejected, deferred or never answered, or cancelled later."
        count={result.notCommitments.length}
        empty="Nothing was proposed and dropped."
      >
        {result.notCommitments.map((n, i) => (
          <article key={i} className="card">
            <h3>
              {n.text} <span className="badge">{KIND[n.kind]}</span>
            </h3>
            <Field label="Why" ids={n.evidence}>
              {n.reason}
            </Field>
          </article>
        ))}
      </Section>
    </>
  );
}

function Checks({ result }: { result: ExtractResult }) {
  const { first, final } = result.problems;
  if (first.length === 0) return <>The first answer passed every check.</>;
  return (
    <>
      {plural(first.length, "problem")} in the first answer went back to the model once.{" "}
      {final.length === 0
        ? "The corrected answer passed."
        : `${plural(final.length, "problem")} remained, so ${plural(result.moved, "item")} moved to Needs clarification.`}
      <details>
        <summary>Show the problems</summary>
        <ul>
          {first.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      </details>
    </>
  );
}

export function RunDetails({ stt, result }: { stt: TranscribeResult; result: ExtractResult | null }) {
  const s = stt.metrics;
  const e = result?.metrics;
  return (
    <section className="section run">
      <h2>How this result was made</h2>
      <dl>
        <dt>Speech to text</dt>
        <dd>
          Deepgram {s.sttModel}: {formatTime(s.audioSeconds)} of audio in {s.sttSeconds.toFixed(1)} s, {usd(s.sttCostUsd)}
        </dd>
        {e && (
          <>
            <dt>Extraction</dt>
            <dd>
              {e.model}, thinking {e.thinkingLevel}: {e.extractSeconds.toFixed(1)} s, {plural(e.calls, "call")},{" "}
              {e.inputTokens.toLocaleString("en")} input and {e.outputTokens.toLocaleString("en")} output tokens, {usd(e.llmCostUsd)}
            </dd>
          </>
        )}
        <dt>Cost</dt>
        <dd>{usd(s.sttCostUsd + (e?.llmCostUsd ?? 0))} at list prices, hosting not included. The demo itself runs on free tiers.</dd>
        {result && !result.decline && (
          <>
            <dt>Checks</dt>
            <dd>
              <Checks result={result} />
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}
