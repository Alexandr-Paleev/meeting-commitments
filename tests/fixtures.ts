// A small hand-made transcript and a model answer that passes every check.
// Tests copy the answer and break one thing at a time.

import type { Extraction } from "../lib/schema";
import type { Transcript } from "../lib/transcript";

const lines: [speaker: number, text: string][] = [
  [0, "Hi, I'm Dana from the platform team."],
  [1, "And I'm Lee."],
  [0, "Lee, can you draft the release notes by Friday?"],
  [1, "Sure, I'll do it."],
  [0, "Actually, let's say Thursday instead."],
  [1, "Thursday works."],
  [0, "We could also redo the logo."],
  [1, "Let's not, it's fine."],
  [0, "Someone has to update the wiki by the 3rd of March 2027."],
  [1, "Today is the first of March 2027, so that's soon."],
];

export const transcript: Transcript = {
  durationSec: 40,
  speakers: [0, 1],
  segments: lines.map(([speaker, text], i) => ({ id: i + 1, speaker, start: i * 4, end: i * 4 + 3, text })),
};

export function validExtraction(): Extraction {
  return {
    decline: null,
    speakers: [
      { label: 0, name: "Dana", evidence: [1] },
      { label: 1, name: "Lee", evidence: [2] },
    ],
    commitments: [
      {
        task: "Draft the release notes",
        evidence: [3, 4],
        owner: { name: "Lee", evidence: [3, 4] },
        deadline: { wording: "Thursday", evidence: [5, 6], needsDateContext: true, resolvedDate: null },
        history: [{ field: "deadline", previous: "by Friday", evidence: [3] }],
      },
      {
        task: "Update the wiki",
        evidence: [9],
        owner: null,
        deadline: {
          wording: "by the 3rd of March 2027",
          evidence: [9],
          needsDateContext: false,
          resolvedDate: { date: "2027-03-03", evidence: [9] },
        },
        history: [],
      },
    ],
    notCommitments: [{ text: "Redo the logo", kind: "rejected", reason: "Lee said no", evidence: [7, 8] }],
    unresolvedQuestions: [],
    clarifications: [],
  };
}
