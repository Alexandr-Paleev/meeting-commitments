// Deterministic checks on the model output, run after every model call.
// The problems from the first call are sent back to the model once (lib/extract.ts). Whatever
// still fails after that is moved to Needs clarification, or for speaker names turned into a
// decline, so an unsupported item is never shown as agreed.

import type { Clarification, Extraction } from "./schema";
import type { Decline, Segment, Transcript } from "./transcript";

export type Section = "commitments" | "notCommitments" | "unresolvedQuestions" | "clarifications";
// index is the item's position in its list; -1 for a problem with the speaker list as a whole.
export type Problem = { section: Section | "speakers"; index: number; message: string };

export type Checked = Omit<Extraction, "decline"> & { decline: Decline | null; moved: number };

// Lowercase words only, so "I'm Anna." contains "anna" and "By Friday," matches "by friday".
export function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function containsPhrase(text: string, phrase: string): boolean {
  const p = normalize(phrase);
  return p.length > 0 && ` ${normalize(text)} `.includes(` ${p} `);
}

const MONTH = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sept?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/i;

const ORDINAL_WORD =
  /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth)\b/i;

// Direct address: the name opens the sentence before a comma ("Anna, can you take this?") or
// closes it after a comma ("Thanks, Anna."). A name in passing ("ask Anna") is not an address.
// Position only: it cannot tell "Thanks, Anna." from "my manager, Anna.", so the prompt asks for
// direct address and this check rules out the rest.
export function addresses(text: string, name: string): boolean {
  const n = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const t = text.trim();
  return n.length > 0 && (new RegExp(`^${n},`, "i").test(t) || new RegExp(`,\\s*${n}[.?!]*$`, "i").test(t));
}

// "November 20th", "the third of March" or "11/20" names a calendar date; "Friday" or "next week" does not.
export function isCalendarDate(wording: string): boolean {
  return (MONTH.test(wording) && (/\d/.test(wording) || ORDINAL_WORD.test(wording))) || /\b\d{1,4}[/.-]\d{1,2}\b/.test(wording);
}

const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const TEENS = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

// 1 to 99 in words: 7 -> "seven", 27 -> "twenty seven".
function upTo99(n: number): string {
  if (n < 10) return ONES[n];
  if (n < 20) return TEENS[n - 10];
  return `${TENS[Math.floor(n / 10)]} ${ONES[n % 10]}`.trim();
}

// The ways a year can appear in the transcript, which keeps numbers as spoken:
// 2027 -> "2027", "twenty twenty seven", "two thousand twenty seven", "two thousand and twenty seven".
export function yearForms(year: number): string[] {
  const century = Math.floor(year / 100);
  const rest = year % 100;
  const forms = [String(year)];
  if (rest >= 10) forms.push(`${upTo99(century)} ${upTo99(rest)}`);
  else if (rest > 0) forms.push(`${upTo99(century)} oh ${ONES[rest]}`);
  if (year >= 2000 && year < 2100) {
    forms.push(rest === 0 ? "two thousand" : `two thousand ${upTo99(rest)}`);
    if (rest > 0) forms.push(`two thousand and ${upTo99(rest)}`);
  }
  return forms;
}

export function verify(x: Extraction, t: Transcript): Problem[] {
  if (x.decline) return [];
  const problems: Problem[] = [];
  const byId = new Map(t.segments.map((s) => [s.id, s]));
  const nameOf = new Map(x.speakers.map((s) => [s.label, s.name]));

  // The cited segments; every id that does not exist is a problem.
  function cited(section: Problem["section"], index: number, what: string, ids: number[]): Segment[] {
    const unknown = ids.filter((id) => !byId.has(id));
    if (unknown.length > 0) problems.push({ section, index, message: `${what}: segment id(s) ${unknown.join(", ")} do not exist` });
    return ids.flatMap((id) => byId.get(id) ?? []);
  }

  // (a) Speakers: both labels once, two different names. A name is confirmed when its speaker says
  // it ("I'm Anna"), or when the other speaker addresses them by it ("Thanks, Anna."). The second
  // way is there because diarization can give a short "I'm Anna." to the wrong label.
  const labels = x.speakers.map((s) => s.label).sort((a, b) => a - b);
  if (labels.join() !== t.speakers.join()) {
    problems.push({ section: "speakers", index: -1, message: `map exactly the labels ${t.speakers.map((l) => `S${l}`).join(" and ")}, each once` });
  }
  const names = x.speakers.map((s) => normalize(s.name));
  if (names.some((n) => !n) || new Set(names).size !== names.length) {
    problems.push({ section: "speakers", index: -1, message: "the two speakers need two different names" });
  }
  x.speakers.forEach((s, i) => {
    const segs = cited("speakers", i, `S${s.label}`, s.evidence);
    // An address names the person spoken to, so it never counts as the speaker's own name.
    const said = segs.some((seg) => seg.speaker === s.label && containsPhrase(seg.text, s.name) && !addresses(seg.text, s.name));
    const addressed = segs.some((seg) => seg.speaker !== s.label && addresses(seg.text, s.name));
    if (!said && !addressed) {
      problems.push({
        section: "speakers",
        index: i,
        message: `no cited segment in which S${s.label} says the name "${s.name}" or the other speaker addresses S${s.label} as "${s.name}"`,
      });
    }
  });

  x.commitments.forEach((c, i) => {
    const add = (message: string) => problems.push({ section: "commitments", index: i, message });
    cited("commitments", i, "evidence", c.evidence);
    // (b) Owner: a cited segment is spoken by the owner or names the owner.
    if (c.owner) {
      const owner = c.owner.name;
      const segs = cited("commitments", i, "owner evidence", c.owner.evidence);
      const supported = segs.some((seg) => normalize(nameOf.get(seg.speaker) ?? "") === normalize(owner) || containsPhrase(seg.text, owner));
      if (!supported) add(`owner "${owner}": no cited segment is spoken by ${owner} or names ${owner}`);
    }
    if (c.deadline) {
      const d = c.deadline;
      const segs = cited("commitments", i, "deadline evidence", d.evidence);
      if (!segs.some((seg) => containsPhrase(seg.text, d.wording))) add(`deadline "${d.wording}" does not appear word for word in the cited segments`);
      if (d.resolvedDate) {
        const context = cited("commitments", i, "date context evidence", d.resolvedDate.evidence);
        const m = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(d.resolvedDate.date);
        if (!m || Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[3]) < 1 || Number(m[3]) > 31) {
          add(`resolved date "${d.resolvedDate.date}" must be a valid MM-DD or YYYY-MM-DD`);
        } else if (m[1] && !context.some((seg) => yearForms(Number(m[1])).some((form) => containsPhrase(seg.text, form)))) {
          add(`resolved date has the year ${m[1]}, but no cited segment says that year`);
        }
        if (d.needsDateContext) add("needsDateContext must be false when the date is resolved");
      } else if (!isCalendarDate(d.wording) && !d.needsDateContext) {
        // (c) Relative wording that is not resolved needs date context.
        add(`deadline "${d.wording}" is relative and not resolved, so needsDateContext must be true`);
      }
    }
    c.history.forEach((h) => cited("commitments", i, `earlier ${h.field}`, h.evidence));
  });

  x.notCommitments.forEach((n, i) => cited("notCommitments", i, "evidence", n.evidence));
  x.unresolvedQuestions.forEach((q, i) => cited("unresolvedQuestions", i, "evidence", q.evidence));
  x.clarifications.forEach((c, i) => {
    cited("clarifications", i, "evidence", c.evidence);
    c.candidates.forEach((k) => cited("clarifications", i, `candidate "${k.value}"`, k.evidence));
  });
  return problems;
}

// Applies the final problems: failing items move to Needs clarification, unknown ids are dropped.
export function applyChecks(x: Extraction, problems: Problem[], t: Transcript): Checked {
  const empty = { speakers: [], commitments: [], notCommitments: [], unresolvedQuestions: [], clarifications: [], moved: 0 };
  if (x.decline) return { ...empty, decline: { reason: x.decline.reason, message: x.decline.explanation } };
  const speakerProblems = problems.filter((p) => p.section === "speakers");
  if (speakerProblems.length > 0) {
    const details = speakerProblems.map((p) => p.message).join("; ");
    return { ...empty, decline: { reason: "speakers_not_identified", message: `The speakers' names could not be confirmed from the recording (${details}).` } };
  }

  const ids = new Set(t.segments.map((s) => s.id));
  const known = (evidence: number[]) => evidence.filter((id) => ids.has(id));
  const moved: Clarification[] = [];
  function keep<T>(section: Section, items: T[], describe: (item: T) => { text: string; evidence: number[] }): T[] {
    return items.filter((item, i) => {
      const failed = problems.filter((p) => p.section === section && p.index === i);
      if (failed.length === 0) return true;
      const { text, evidence } = describe(item);
      moved.push({
        text,
        question: `Our checks could not confirm this item: ${failed.map((p) => p.message).join("; ")}. What was actually agreed?`,
        candidates: [],
        evidence: known(evidence),
      });
      return false;
    });
  }

  return {
    decline: null,
    speakers: x.speakers,
    commitments: keep("commitments", x.commitments, (c) => ({ text: c.task, evidence: c.evidence })),
    notCommitments: keep("notCommitments", x.notCommitments, (n) => ({ text: n.text, evidence: n.evidence })),
    unresolvedQuestions: keep("unresolvedQuestions", x.unresolvedQuestions, (q) => ({ text: q.question, evidence: q.evidence })),
    clarifications: [
      ...x.clarifications.map((c) => ({
        ...c,
        evidence: known(c.evidence),
        candidates: c.candidates.map((k) => ({ ...k, evidence: known(k.evidence) })),
      })),
      ...moved,
    ],
    moved: moved.length,
  };
}
