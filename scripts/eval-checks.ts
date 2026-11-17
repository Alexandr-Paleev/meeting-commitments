// Compares one pipeline run with samples/<name>.expected.json, by the rules in samples/README.md.
// Pure functions without network: scripts/eval.ts runs the pipeline and writes the report.

import type { ExtractResult } from "../lib/extract";
import { formatTime } from "../lib/format";
import type { Commitment } from "../lib/schema";
import type { Segment, TranscribeResult } from "../lib/transcript";
import { containsPhrase, normalize, type Section } from "../lib/verify";

export type ExpectedItem = {
  id: string;
  section: "commitment" | "not_commitment" | "unresolved_question" | "clarification";
  keywords: string[];
  owner: string | null;
  deadline: string | null;
  needsDateContext: boolean | null;
  resolvedDate: string | null;
  deadlineHistory: string[];
  kind: string | null;
  lines: number[];
  ownerLines: number[];
  deadlineLines: number[];
  dateContextLines: number[];
};

// A decline sample has only `sample` and `decline`.
export type Expected = {
  sample: string;
  decline: string | null;
  speakers?: Record<string, number[]>;
  items?: ExpectedItem[];
  mustNotBeAgreed?: { keywords: string[]; lines: number[]; why: string }[];
};

export type ManifestLine = { line: string; speaker: string; start: number; end: number; text: string };
export type Manifest = { title: string; lines: ManifestLine[] };

// One run: the transcript step, and the extraction step unless the input was declined before it.
export type RunOutput = { stt: TranscribeResult; extraction: ExtractResult | null };

// "skip": not checked because the check it depends on failed (the owner of an item not found).
export type Check = { name: string; status: "pass" | "fail" | "skip"; detail?: string };

export const SECTION: Record<ExpectedItem["section"], Section> = {
  commitment: "commitments",
  not_commitment: "notCommitments",
  unresolved_question: "unresolvedQuestions",
  clarification: "clarifications",
};

export const SECTION_TITLE: Record<Section, string> = {
  commitments: "Final commitments",
  notCommitments: "Not commitments",
  unresolvedQuestions: "Unresolved questions",
  clarifications: "Needs clarification",
};

// A quote counts for a script line when it overlaps the line's true time range, give or take this.
const TOLERANCE_SEC = 0.3;

// "By Tuesday," -> "tuesday": case, punctuation and a leading "by" or "before" do not count.
export function deadlineKey(wording: string | null | undefined): string | null {
  return wording ? normalize(wording).replace(/^(by|before) /, "") : null;
}

// One output item, in a shape all four sections share.
type Found = {
  section: Section;
  text: string; // the item's own words
  evidence: number[]; // the quotes that prove the item, checked against its script lines
  quoted: number[]; // every quote shown with the item
  commitment?: Commitment;
  kind?: string;
};

function itemsOf(x: ExtractResult): Found[] {
  return [
    ...x.commitments.map((c) => ({
      section: "commitments" as const,
      text: c.task,
      evidence: c.evidence,
      quoted: [
        ...c.evidence,
        ...(c.owner?.evidence ?? []),
        ...(c.deadline?.evidence ?? []),
        ...(c.deadline?.resolvedDate?.evidence ?? []),
        ...c.history.flatMap((h) => h.evidence),
      ],
      commitment: c,
    })),
    ...x.notCommitments.map((n) => ({ section: "notCommitments" as const, text: n.text, evidence: n.evidence, quoted: n.evidence, kind: n.kind })),
    ...x.unresolvedQuestions.map((q) => ({ section: "unresolvedQuestions" as const, text: q.question, evidence: q.evidence, quoted: q.evidence })),
    ...x.clarifications.map((c) => {
      const all = [...c.evidence, ...c.candidates.flatMap((k) => k.evidence)];
      return { section: "clarifications" as const, text: [c.text, c.question, ...c.candidates.map((k) => k.value)].join(" "), evidence: all, quoted: all };
    }),
  ];
}

// Who really said a segment: the speaker of the script line it overlaps most.
function whoSaid(segment: Segment, manifest: Manifest): string | null {
  let best: string | null = null;
  let bestOverlap = 0;
  for (const line of manifest.lines) {
    const overlap = Math.min(segment.end, line.end + TOLERANCE_SEC) - Math.max(segment.start, line.start - TOLERANCE_SEC);
    if (overlap > bestOverlap) [best, bestOverlap] = [line.speaker, overlap];
  }
  return best;
}

const asName = (speaker: string) => speaker.charAt(0) + speaker.slice(1).toLowerCase(); // "LAURA" -> "Laura"

// Where an item ended up and with which values, for B vs A. Quotes are left out.
function signature(f: Found | undefined): string {
  if (!f) return "missing";
  const c = f.commitment;
  const d = c?.deadline;
  return JSON.stringify([f.section, c?.owner ? normalize(c.owner.name) : null, deadlineKey(d?.wording), d?.needsDateContext ?? null, d?.resolvedDate?.date ?? null, f.kind ?? null]);
}

export function checkRun(expected: Expected, manifest: Manifest, run: RunOutput): { checks: Check[]; signatures: Record<string, string> } {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean | null, detail: string) =>
    checks.push(ok === null ? { name, status: "skip" } : ok ? { name, status: "pass" } : { name, status: "fail", detail });

  const decline = run.stt.decline ?? run.extraction?.decline ?? null;
  const declined = decline ? `declined as ${decline.reason}: ${decline.message}` : "not declined";
  if (expected.decline) {
    add(`declined as ${expected.decline}`, decline?.reason === expected.decline, declined);
    return { checks, signatures: {} };
  }
  const x = decline ? null : run.extraction;
  add("not declined", x !== null, declined);

  const segments = run.stt.transcript.segments;
  const byId = new Map(segments.map((s) => [s.id, s]));
  const scriptLine = new Map(manifest.lines.map((l) => [Number(l.line), l]));
  const quotes = (ids: number[]) =>
    ids.map((id) => (byId.has(id) ? `[${id}] ${formatTime(byId.get(id)!.start)} "${byId.get(id)!.text}"` : `[${id}]`)).join(", ") || "none";
  // How many of the cited segments overlap one of the script lines.
  const hits = (ids: number[], lines: number[]) =>
    ids.filter((id) => {
      const s = byId.get(id);
      return s !== undefined && lines.some((n) => {
        const l = scriptLine.get(n);
        return l !== undefined && s.start < l.end + TOLERANCE_SEC && s.end > l.start - TOLERANCE_SEC;
      });
    }).length;
  const hasKeywords = (f: Found, keywords: string[]) => {
    const text = [f.text, ...f.quoted.map((id) => byId.get(id)?.text ?? "")].join(" ");
    return keywords.every((k) => k.split("|").some((alternative) => containsPhrase(text, alternative)));
  };

  // Speakers: the expected names, each on the label whose speech is mostly that person's.
  const names = new Map(x?.speakers.map((s) => [s.label, s.name]));
  const mostlySaidBy = (label: number) => {
    const seconds = new Map<string, number>();
    for (const s of segments.filter((seg) => seg.speaker === label)) {
      const who = whoSaid(s, manifest);
      if (who) seconds.set(who, (seconds.get(who) ?? 0) + s.end - s.start);
    }
    return [...seconds].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "nobody";
  };
  const expectedNames = Object.keys(expected.speakers ?? {});
  const speakerProblems = (x?.speakers ?? []).flatMap((s) =>
    normalize(s.name) === normalize(mostlySaidBy(s.label)) ? [] : [`S${s.label} is named ${s.name}, but it is mostly ${asName(mostlySaidBy(s.label))}`],
  );
  if (x && JSON.stringify(x.speakers.map((s) => normalize(s.name)).sort()) !== JSON.stringify(expectedNames.map(normalize).sort())) {
    speakerProblems.unshift(`the names are ${x.speakers.map((s) => s.name).join(" and ") || "missing"}`);
  }
  add(`speakers ${expectedNames.join(" and ")}, each on the right label`, x ? speakerProblems.length === 0 : null, speakerProblems.join("; "));

  // Each expected item takes one output item: first in its own section, then in any other one, to
  // report where it went. Of several candidates, the one with the most quotes on its lines wins.
  const found = x ? itemsOf(x) : [];
  const items = expected.items ?? [];
  const matched = new Map<string, Found>();
  for (const ownSection of [true, false]) {
    for (const item of items) {
      if (matched.has(item.id)) continue;
      const taken = new Set(matched.values());
      const candidates = found.filter((f) => !taken.has(f) && (f.section === SECTION[item.section]) === ownSection && hasKeywords(f, item.keywords));
      const best = candidates.sort((a, b) => hits(b.evidence, item.lines) - hits(a.evidence, item.lines))[0];
      if (best) matched.set(item.id, best);
    }
  }

  for (const item of items) {
    const f = matched.get(item.id);
    const own = f?.section === SECTION[item.section] ? f : undefined;
    const name = (what: string) => `${item.id}: ${what}`;
    const where = f ? `found in ${SECTION_TITLE[f.section]}${f.kind ? ` as ${f.kind}` : ""}: "${f.text}"` : "not found";
    add(name(`in ${SECTION_TITLE[SECTION[item.section]]}`), own !== undefined, where);

    if (item.section === "commitment") {
      const c = own?.commitment;
      const ownerOk = c ? normalize(c.owner?.name ?? "") === normalize(item.owner ?? "") : null;
      add(name(`owner ${item.owner ?? "none"}`), ownerOk, `owner is ${c?.owner?.name ?? "none"}`);
      const deadlineOk = c ? deadlineKey(c.deadline?.wording) === deadlineKey(item.deadline) : null;
      add(name(`deadline ${item.deadline ?? "none"}`), deadlineOk, `deadline is ${c?.deadline?.wording ?? "none"}`);
      const d = deadlineOk ? (c?.deadline ?? null) : null; // flags are compared only when the wording matched
      if (item.deadline !== null) {
        add(name(`needsDateContext ${item.needsDateContext}`), d ? d.needsDateContext === item.needsDateContext : null, `needsDateContext is ${d?.needsDateContext}`);
        add(name(`resolved date ${item.resolvedDate ?? "none"}`), d ? (d.resolvedDate?.date ?? null) === item.resolvedDate : null, `resolved date is ${d?.resolvedDate?.date ?? "none"}`);
      }
      const history = c?.history.filter((h) => h.field === "deadline").map((h) => h.previous);
      add(
        name(`earlier deadlines ${item.deadlineHistory.join(", ") || "none"}`),
        history ? JSON.stringify(history.map(deadlineKey)) === JSON.stringify(item.deadlineHistory.map(deadlineKey)) : null,
        `earlier deadlines are ${history?.join(", ") || "none"}`,
      );
      if (item.ownerLines.length > 0) {
        add(name(`owner quote at line ${item.ownerLines.join(", ")}`), ownerOk && c?.owner ? hits(c.owner.evidence, item.ownerLines) > 0 : null, `owner quotes are ${quotes(c?.owner?.evidence ?? [])}`);
      }
      if (item.deadlineLines.length > 0) {
        add(name(`deadline quote at line ${item.deadlineLines.join(", ")}`), d ? hits(d.evidence, item.deadlineLines) > 0 : null, `deadline quotes are ${quotes(d?.evidence ?? [])}`);
      }
      if (item.dateContextLines.length > 0) {
        const context = d?.resolvedDate?.date === item.resolvedDate ? d?.resolvedDate : undefined;
        add(name(`date context quote at line ${item.dateContextLines.join(", ")}`), context ? hits(context.evidence, item.dateContextLines) > 0 : null, `date context quotes are ${quotes(context?.evidence ?? [])}`);
      }
    }
    if (item.section === "not_commitment") add(name(`kind ${item.kind}`), own ? own.kind === item.kind : null, `kind is ${own?.kind}`);
    add(name(`quotes at line ${item.lines.join(", ")}`), own ? hits(own.evidence, item.lines) > 0 : null, `quotes are ${quotes(own?.evidence ?? [])}`);
  }

  // Exclusion: nothing that must not be agreed, and no commitment beyond the expected ones.
  const commitments = found.filter((f) => f.section === "commitments");
  for (const m of expected.mustNotBeAgreed ?? []) {
    const agreed = commitments.filter((f) => hasKeywords(f, m.keywords));
    add(`not agreed: ${m.keywords.join(" ")}`, x ? agreed.length === 0 : null, `listed as agreed: ${agreed.map((f) => `"${f.text}"`).join(", ")}`);
  }
  const taken = new Set(matched.values());
  const extra = commitments.filter((f) => !taken.has(f));
  add("no other commitments", x ? extra.length === 0 : null, `also listed: ${extra.map((f) => `"${f.text}"`).join(", ")}`);

  // Every quote on the page shows the person who really said it.
  const cited = [...new Set([...(x?.speakers.flatMap((s) => s.evidence) ?? []), ...found.flatMap((f) => f.quoted)])].sort((a, b) => a - b);
  const misattributed = cited.flatMap((id) => {
    const s = byId.get(id);
    const said = s ? whoSaid(s, manifest) : null;
    const shown = s ? names.get(s.speaker) : undefined;
    if (s && said && normalize(said) === normalize(shown ?? "")) return [];
    return [`${quotes([id])} is shown as ${shown ?? (s ? `S${s.speaker}` : "unknown")}, said by ${said ? asName(said) : "nobody in the script"}`];
  });
  add("every quote shows who really said it", x ? misattributed.length === 0 : null, misattributed.join("; "));

  return { checks, signatures: Object.fromEntries(items.map((item) => [item.id, signature(matched.get(item.id))])) };
}

// B vs A: the items whose section or values differ between the two expected files.
export function expectedDifference(a: Expected, b: Expected): string[] {
  const key = (items: ExpectedItem[] | undefined, id: string) => {
    const i = items?.find((item) => item.id === id);
    if (!i) return "missing";
    return JSON.stringify([SECTION[i.section], i.owner ? normalize(i.owner) : null, deadlineKey(i.deadline), i.needsDateContext, i.resolvedDate, i.kind]);
  };
  const ids = [...new Set([...(a.items ?? []), ...(b.items ?? [])].map((i) => i.id))];
  return ids.filter((id) => key(a.items, id) !== key(b.items, id)).sort();
}

// B vs A on two runs: the items whose section or values differ between the outputs.
export function actualDifference(a: Record<string, string>, b: Record<string, string>): string[] {
  const ids = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return ids.filter((id) => (a[id] ?? "missing") !== (b[id] ?? "missing")).sort();
}
