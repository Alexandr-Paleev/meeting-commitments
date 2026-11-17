import { describe, expect, it } from "vitest";
import { addresses, applyChecks, containsPhrase, isCalendarDate, verify, yearForms } from "../lib/verify";
import { transcript, validExtraction } from "./fixtures";

const messages = (x: ReturnType<typeof validExtraction>) => verify(x, transcript).map((p) => p.message);

describe("verify", () => {
  it("finds nothing in a supported answer", () => {
    expect(verify(validExtraction(), transcript)).toEqual([]);
  });

  it("flags segment ids that do not exist", () => {
    const x = validExtraction();
    x.commitments[0].evidence = [3, 99];
    expect(messages(x)).toEqual(["evidence: segment id(s) 99 do not exist"]);
  });

  it("(a) flags a speaker name that nobody says", () => {
    const x = validExtraction();
    x.speakers[1].name = "Pat";
    expect(messages(x)).toEqual(['no cited segment in which S1 says the name "Pat" or the other speaker addresses S1 as "Pat"']);
  });

  it("(a) flags names taken from the other speaker's segments (labels swapped)", () => {
    const x = validExtraction();
    x.speakers = [
      { label: 0, name: "Lee", evidence: [2] },
      { label: 1, name: "Dana", evidence: [1] },
    ];
    expect(messages(x)).toEqual([
      'no cited segment in which S0 says the name "Lee" or the other speaker addresses S0 as "Lee"',
      'no cited segment in which S1 says the name "Dana" or the other speaker addresses S1 as "Dana"',
    ]);
  });

  it("(a) accepts a speaker whom the other speaker addresses by name", () => {
    const x = validExtraction();
    x.speakers[1].evidence = [3]; // Dana (S0): "Lee, can you draft the release notes by Friday?"
    expect(verify(x, transcript)).toEqual([]);
  });

  it("(a) does not take an address as the speaker's own name", () => {
    const x = validExtraction();
    x.speakers[0] = { label: 0, name: "Lee", evidence: [3] }; // S0 says "Lee, ...": that names S1
    x.speakers[1] = { label: 1, name: "Dana", evidence: [1] };
    expect(messages(x)).toContain('no cited segment in which S0 says the name "Lee" or the other speaker addresses S0 as "Lee"');
  });

  it("(a) does not take a name in passing as an address", () => {
    const t = structuredClone(transcript);
    t.segments[6].text = "We could also ask Lee to redo the logo."; // S0
    const x = validExtraction();
    x.speakers[1].evidence = [7];
    expect(verify(x, t).map((p) => p.message)).toEqual([
      'no cited segment in which S1 says the name "Lee" or the other speaker addresses S1 as "Lee"',
    ]);
  });

  it("(a) flags two speakers with the same name", () => {
    const x = validExtraction();
    x.speakers[1].name = "Dana";
    expect(messages(x)).toContain("the two speakers need two different names");
  });

  it("(b) flags an owner that the cited segments do not support", () => {
    const x = validExtraction();
    x.commitments[0].owner = { name: "Dana", evidence: [4] }; // spoken by Lee, does not name Dana
    expect(messages(x)).toEqual(['owner "Dana": no cited segment is spoken by Dana or names Dana']);
  });

  it("accepts an owner who commits in their own words", () => {
    const x = validExtraction();
    x.commitments[0].owner = { name: "Lee", evidence: [4] }; // "Sure, I'll do it." said by Lee
    expect(verify(x, transcript)).toEqual([]);
  });

  it("flags deadline wording that is not quoted as spoken", () => {
    const x = validExtraction();
    x.commitments[0].deadline!.wording = "by Thursday";
    expect(messages(x)).toEqual(['deadline "by Thursday" does not appear word for word in the cited segments']);
  });

  it("(c) flags relative wording without a date when needsDateContext is false", () => {
    const x = validExtraction();
    x.commitments[0].deadline!.needsDateContext = false;
    expect(messages(x)).toEqual(['deadline "Thursday" is relative and not resolved, so needsDateContext must be true']);
  });

  it("accepts a calendar date that is not resolved further", () => {
    const x = validExtraction();
    x.commitments[1].deadline!.resolvedDate = null;
    expect(verify(x, transcript)).toEqual([]);
  });

  it("accepts a calendar date and a year said in words, as the transcript keeps them", () => {
    const t = structuredClone(transcript);
    t.segments[8].text = "Someone has to update the wiki by the third of March twenty twenty seven.";
    const x = validExtraction();
    x.commitments[1].deadline!.wording = "by the third of March twenty twenty seven";
    expect(verify(x, t)).toEqual([]);
    x.commitments[1].deadline!.resolvedDate = null; // still a calendar date, so no date context is needed
    expect(verify(x, t)).toEqual([]);
  });

  it("flags a resolved year that nobody said", () => {
    const x = validExtraction();
    x.commitments[1].deadline!.resolvedDate = { date: "2026-03-03", evidence: [9] };
    expect(messages(x)).toEqual(["resolved date has the year 2026, but no cited segment says that year"]);
  });

  it("flags an invalid resolved date and needsDateContext set next to a resolved date", () => {
    const x = validExtraction();
    x.commitments[1].deadline = { ...x.commitments[1].deadline!, needsDateContext: true, resolvedDate: { date: "2027-13-03", evidence: [9] } };
    expect(messages(x)).toEqual([
      'resolved date "2027-13-03" must be a valid MM-DD or YYYY-MM-DD',
      "needsDateContext must be false when the date is resolved",
    ]);
  });

  it("checks nothing when the model declined", () => {
    const x = { ...validExtraction(), decline: { reason: "unintelligible" as const, explanation: "Garbled." } };
    expect(verify(x, transcript)).toEqual([]);
  });
});

describe("applyChecks", () => {
  it("keeps a supported answer as it is", () => {
    const x = validExtraction();
    const checked = applyChecks(x, [], transcript);
    expect(checked.commitments).toEqual(x.commitments);
    expect(checked.moved).toBe(0);
    expect(checked.decline).toBeNull();
  });

  it("moves a commitment that still fails to Needs clarification", () => {
    const x = validExtraction();
    x.commitments[0].owner = { name: "Dana", evidence: [4] };
    const checked = applyChecks(x, verify(x, transcript), transcript);
    expect(checked.commitments.map((c) => c.task)).toEqual(["Update the wiki"]);
    expect(checked.moved).toBe(1);
    expect(checked.clarifications[0]).toMatchObject({ text: "Draft the release notes", evidence: [3, 4], candidates: [] });
    expect(checked.clarifications[0].question).toContain('owner "Dana"');
  });

  it("drops unknown ids from the moved item's evidence", () => {
    const x = validExtraction();
    x.notCommitments[0].evidence = [7, 42];
    const checked = applyChecks(x, verify(x, transcript), transcript);
    expect(checked.notCommitments).toEqual([]);
    expect(checked.clarifications[0].evidence).toEqual([7]);
  });

  it("turns unconfirmed speaker names into a decline", () => {
    const x = validExtraction();
    x.speakers[1].name = "Pat";
    const checked = applyChecks(x, verify(x, transcript), transcript);
    expect(checked.decline?.reason).toBe("speakers_not_identified");
    expect(checked.commitments).toEqual([]);
  });

  it("passes the model's own decline on", () => {
    const x = { ...validExtraction(), decline: { reason: "unintelligible" as const, explanation: "Garbled." } };
    expect(applyChecks(x, [], transcript).decline).toEqual({ reason: "unintelligible", message: "Garbled." });
  });
});

describe("helpers", () => {
  it("matches whole words, ignoring case and punctuation", () => {
    expect(containsPhrase("Hi, I'm Anna.", "anna")).toBe(true);
    expect(containsPhrase("Hi, I'm Annabel.", "anna")).toBe(false);
    expect(containsPhrase("Done by Friday, okay?", "by Friday")).toBe(true);
  });

  it("finds a direct address only where the name opens or closes the sentence", () => {
    expect(addresses("Lee, can you draft it?", "Lee")).toBe(true);
    expect(addresses("Thanks, Lee.", "Lee")).toBe(true);
    expect(addresses("Could you take it, lee?", "Lee")).toBe(true);
    expect(addresses("Maybe Lee could take it.", "Lee")).toBe(false);
    expect(addresses("And I'm Lee.", "Lee")).toBe(false);
    expect(addresses("Leela, can you take it?", "Lee")).toBe(false);
    expect(addresses("Thanks, Ashlee.", "Lee")).toBe(false);
  });

  it("tells calendar dates from relative wording", () => {
    expect(isCalendarDate("by November 20th")).toBe(true);
    expect(isCalendarDate("11/20")).toBe(true);
    expect(isCalendarDate("by the third of March")).toBe(true);
    expect(isCalendarDate("by Friday")).toBe(false);
    expect(isCalendarDate("end of next week")).toBe(false);
  });

  it("lists the ways a year can be said", () => {
    expect(yearForms(2027)).toEqual(["2027", "twenty twenty seven", "two thousand twenty seven", "two thousand and twenty seven"]);
    expect(yearForms(2005)).toContain("twenty oh five");
    expect(yearForms(1999)).toEqual(["1999", "nineteen ninety nine"]);
  });
});
