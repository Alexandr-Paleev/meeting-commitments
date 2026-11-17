// The eval's rules on a tiny made-up recording. No network.

import { describe, expect, it } from "vitest";
import type { ExtractResult } from "../lib/extract";
import type { Transcript } from "../lib/transcript";
import { actualDifference, checkRun, expectedDifference, type Expected, type Manifest, type RunOutput } from "../scripts/eval-checks";

const manifest: Manifest = {
  title: "Test",
  lines: [
    { line: "1", speaker: "ANNA", start: 0.5, end: 2, text: "Hi, I'm Anna." },
    { line: "2", speaker: "BEN", start: 2.5, end: 4, text: "I'm Ben." },
    { line: "3", speaker: "ANNA", start: 4.5, end: 8, text: "Ben, can you send the report by Friday?" },
    { line: "4", speaker: "BEN", start: 8.5, end: 11, text: "Sure, I'll send it by Friday." },
  ],
};

const expected = (): Expected => ({
  sample: "T",
  decline: null,
  speakers: { Anna: [1], Ben: [2] },
  items: [
    {
      id: "report",
      section: "commitment",
      keywords: ["report"],
      owner: "Ben",
      deadline: "by Friday",
      needsDateContext: true,
      resolvedDate: null,
      deadlineHistory: [],
      kind: null,
      lines: [3, 4],
      ownerLines: [4],
      deadlineLines: [4],
      dateContextLines: [],
    },
  ],
  mustNotBeAgreed: [],
});

function run(): RunOutput {
  const transcript: Transcript = {
    durationSec: 11,
    speakers: [0, 1],
    segments: manifest.lines.map((l, i) => ({ id: i + 1, speaker: i % 2, start: l.start + 0.05, end: l.end, text: l.text })),
  };
  const extraction: ExtractResult = {
    decline: null,
    speakers: [
      { label: 0, name: "Anna", evidence: [1] },
      { label: 1, name: "Ben", evidence: [2] },
    ],
    commitments: [
      {
        task: "Send the report",
        evidence: [3, 4],
        owner: { name: "Ben", evidence: [4] },
        deadline: { wording: "Friday", evidence: [4], needsDateContext: true, resolvedDate: null },
        history: [],
      },
    ],
    notCommitments: [],
    unresolvedQuestions: [],
    clarifications: [],
    moved: 0,
    problems: { first: [], final: [] },
    metrics: { model: "test", thinkingLevel: "high", calls: 1, retries: 0, extractSeconds: 1, inputTokens: 1, outputTokens: 1, thinkingTokens: 0, llmCostUsd: 0 },
  };
  return { stt: { transcript, decline: null, metrics: { sttModel: "test", audioSeconds: 11, sttSeconds: 1, sttCostUsd: 0 } }, extraction };
}

const failed = (r: RunOutput, e = expected()) => checkRun(e, manifest, r).checks.filter((c) => c.status === "fail");

describe("checkRun", () => {
  it("passes a correct answer, with or without the 'by' of the deadline", () => {
    const { checks } = checkRun(expected(), manifest, run());
    expect(checks.filter((c) => c.status !== "pass")).toEqual([]);
    expect(checks.map((c) => c.name)).toContain("report: deadline by Friday");
  });

  it("says where a missing item went and skips the checks that depend on it", () => {
    const r = run();
    r.extraction!.commitments = [];
    r.extraction!.unresolvedQuestions = [{ question: "Who sends the report?", evidence: [3] }];
    const { checks } = checkRun(expected(), manifest, r);
    expect(checks.find((c) => c.name === "report: in Final commitments")).toMatchObject({
      status: "fail",
      detail: 'found in Unresolved questions: "Who sends the report?"',
    });
    expect(checks.find((c) => c.name === "report: owner Ben")?.status).toBe("skip");
  });

  it("flags a quote shown with the wrong speaker", () => {
    const r = run();
    r.stt.transcript.segments[3].speaker = 0; // Ben's line labelled as Anna's
    expect(failed(r).map((c) => c.name)).toEqual(["every quote shows who really said it"]);
  });

  it("flags a quote that is not on the item's lines", () => {
    const r = run();
    r.extraction!.commitments[0].owner = { name: "Ben", evidence: [2] }; // "I'm Ben.", not line 4
    expect(failed(r).map((c) => c.name)).toEqual(["report: owner quote at line 4"]);
  });

  it("flags what must not be agreed and any commitment that was not expected", () => {
    const e = expected();
    e.items = [];
    e.mustNotBeAgreed = [{ keywords: ["report"], lines: [3], why: "test" }];
    expect(failed(run(), e).map((c) => c.name)).toEqual(["not agreed: report", "no other commitments"]);
  });

  it("checks a decline sample by its reason only", () => {
    const r = run();
    r.extraction!.decline = { reason: "speakers_not_identified", message: "No names." };
    const e: Expected = { sample: "T", decline: "speakers_not_identified" };
    expect(checkRun(e, manifest, r).checks).toEqual([{ name: "declined as speakers_not_identified", status: "pass" }]);
  });
});

describe("B vs A", () => {
  it("finds the items whose expected values differ, and compares two outputs the same way", () => {
    const b = expected();
    b.items![0].owner = "Anna";
    expect(expectedDifference(expected(), b)).toEqual(["report"]);
    const { signatures } = checkRun(expected(), manifest, run());
    expect(actualDifference(signatures, signatures)).toEqual([]);
    expect(actualDifference(signatures, {})).toEqual(["report"]);
  });
});
