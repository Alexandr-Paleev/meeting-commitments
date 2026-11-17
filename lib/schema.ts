// The model's output format. It is sent to Gemini as a JSON schema (structured output) and the
// reply is validated with the same Zod schema.
// Evidence is always a list of segment ids. Code turns ids into quotes, speakers and times,
// so the model cannot invent a quote. Nullable values are whole objects, never bare strings,
// to stay within the documented JSON schema features.

import { z } from "zod";

// A new schema per field, so each field keeps its own description (a shared schema can be
// emitted once as a $ref with one description).
const evidence = (description = "Ids of the transcript segments that support this, for example [4, 5]") =>
  z.array(z.number()).min(1).describe(description);

export const Extraction = z.object({
  decline: z
    .object({
      reason: z.enum(["speakers_not_identified", "unintelligible"]),
      explanation: z.string(),
    })
    .nullable()
    .describe("Set only when no list can be produced, otherwise null"),
  speakers: z.array(
    z.object({
      label: z.number().describe("Speaker label from the transcript: 0 for S0, 1 for S1"),
      name: z.string().describe("The name this speaker gives for themselves"),
      evidence: evidence("Segments spoken by this speaker in which they say their own name"),
    }),
  ),
  commitments: z.array(
    z.object({
      task: z.string(),
      evidence: evidence("The request and its acceptance, the decision, or the self-commitment"),
      owner: z.object({ name: z.string(), evidence: evidence() }).nullable(),
      deadline: z
        .object({
          wording: z.string().describe("The agreed deadline exactly as spoken"),
          evidence: evidence(),
          needsDateContext: z.boolean(),
          resolvedDate: z
            .object({
              date: z.string().describe('"MM-DD", or "YYYY-MM-DD" only if a year is said'),
              evidence: evidence("Segments that state the date context"),
            })
            .nullable(),
        })
        .nullable(),
      history: z
        .array(
          z.object({
            field: z.enum(["owner", "deadline"]),
            previous: z.string().describe("The earlier value, as spoken"),
            evidence: evidence(),
          }),
        )
        .describe("Earlier values replaced by a later correction, oldest first"),
    }),
  ),
  notCommitments: z.array(
    z.object({
      text: z.string(),
      kind: z.enum(["rejected", "deferred", "unanswered", "cancelled"]),
      reason: z.string(),
      evidence: evidence(),
    }),
  ),
  unresolvedQuestions: z.array(z.object({ question: z.string(), evidence: evidence() })),
  clarifications: z.array(
    z.object({
      text: z.string(),
      question: z.string().describe("A specific question that would settle it"),
      candidates: z.array(z.object({ value: z.string(), evidence: evidence() })),
      evidence: evidence(),
    }),
  ),
});

export type Extraction = z.infer<typeof Extraction>;
export type Commitment = Extraction["commitments"][number];
export type Clarification = Extraction["clarifications"][number];

// What Gemini receives as responseJsonSchema. Every keyword Zod emits here is in Gemini's
// supported list except "$schema", which is dropped.
const generated: Record<string, unknown> = { ...z.toJSONSchema(Extraction) };
delete generated.$schema;
export const EXTRACTION_JSON_SCHEMA = generated;
