import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { WORKING_TIME_RULES, describeIssue, findWorkingTimeIssues, rulesFor, type WorkStretch } from "./working-time-checks";

const at = (iso: string) => new Date(iso);
/** A stretch of work on `day`, from and to UTC times on that day (or the next, given in full). */
function work(day: string, from: string, to: string): WorkStretch {
  const start = at(from.includes("T") ? from : `${day}T${from}:00Z`);
  const end = at(to.includes("T") ? to : `${day}T${to}:00Z`);
  return { day, start, end, minutes: Math.round((end.getTime() - start.getTime()) / 60000) };
}
const types = (issues: { type: string }[]) => issues.map((i) => i.type).sort();

describe("rulesFor", () => {
  it("checks nothing when the rule set is off, which every US rule set is", () => {
    expect(rulesFor("OFF")).toBeNull();
    expect(rulesFor(null)).toBeNull();
    expect(rulesFor("DE")?.country).toBe("DE");
  });
});

describe("Germany", () => {
  const de = WORKING_TIME_RULES.DE;

  it("flags a day over 10 hours", () => {
    const issues = findWorkingTimeIssues([work("2026-11-02", "06:00", "12:00"), work("2026-11-02", "12:45", "17:30")], de, null);
    expect(types(issues)).toEqual(["LONG_SHIFT"]);
  });

  it("asks for 30 minutes of breaks after 6 hours, in blocks of at least 15", () => {
    const enough = [work("2026-11-02", "08:00", "12:00"), work("2026-11-02", "12:30", "15:30")];
    expect(findWorkingTimeIssues(enough, de, null)).toEqual([]);

    const tooShortBlocks = [work("2026-11-02", "08:00", "10:00"), work("2026-11-02", "10:10", "13:00"), work("2026-11-02", "13:10", "15:30")];
    expect(types(findWorkingTimeIssues(tooShortBlocks, de, null))).toEqual(["SHORT_BREAK"]);
  });

  it("asks for 45 minutes after 9 hours", () => {
    const issues = findWorkingTimeIssues([work("2026-11-02", "07:00", "12:00"), work("2026-11-02", "12:30", "17:00")], de, null);
    expect(issues).toEqual([expect.objectContaining({ type: "SHORT_BREAK", needMinutes: 45, breakMinutes: 30 })]);
  });

  it("flags less than 11 hours of rest between two working days", () => {
    const issues = findWorkingTimeIssues([work("2026-11-02", "14:00", "18:00"), work("2026-11-02", "18:30", "22:00"), work("2026-11-03", "06:00", "10:00")], de, null);
    expect(issues).toEqual([expect.objectContaining({ type: "SHORT_REST", day: "2026-11-03", restMinutes: 480 })]);
  });

  it("checks the first day's rest against the last timecard's work", () => {
    const issues = findWorkingTimeIssues([work("2026-11-02", "05:00", "09:00")], de, at("2026-11-01T22:00:00Z"));
    expect(types(issues)).toEqual(["SHORT_REST"]);
  });

  it("does not read a night shift cut at midnight as a missing rest", () => {
    const night = [work("2026-11-02", "22:00", "2026-11-03T00:00:00Z"), work("2026-11-03", "00:00", "04:00")];
    expect(findWorkingTimeIssues(night, de, null)).toEqual([]);
  });
});

describe("Netherlands", () => {
  const nl = WORKING_TIME_RULES.NL;

  it("allows up to 12 hours a shift", () => {
    const eleven = [work("2026-11-02", "06:00", "11:30"), work("2026-11-02", "12:15", "17:45")];
    expect(findWorkingTimeIssues(eleven, nl, null)).toEqual([]);
    const overTwelve = [work("2026-11-02", "05:00", "11:30"), work("2026-11-02", "12:15", "18:45")];
    expect(types(findWorkingTimeIssues(overTwelve, nl, null))).toEqual(["LONG_SHIFT"]);
  });

  it("asks for 30 minutes after 5.5 hours", () => {
    expect(types(findWorkingTimeIssues([work("2026-11-02", "08:00", "14:00")], nl, null))).toEqual(["SHORT_BREAK"]);
  });
});

describe("United Kingdom", () => {
  const uk = WORKING_TIME_RULES.UK;

  it("has no daily maximum", () => {
    const long = [work("2026-11-02", "05:00", "11:00"), work("2026-11-02", "11:30", "18:30")];
    expect(findWorkingTimeIssues(long, uk, null)).toEqual([]);
  });

  it("needs one uninterrupted 20 minute break, not two short ones", () => {
    const twoShort = [work("2026-11-02", "08:00", "10:00"), work("2026-11-02", "10:15", "12:30"), work("2026-11-02", "12:45", "15:00")];
    expect(types(findWorkingTimeIssues(twoShort, uk, null))).toEqual(["SHORT_BREAK"]);
    const oneLong = [work("2026-11-02", "08:00", "11:30"), work("2026-11-02", "11:50", "15:00")];
    expect(findWorkingTimeIssues(oneLong, uk, null)).toEqual([]);
  });
});

describe("describeIssue", () => {
  it("reads as plain words", () => {
    expect(describeIssue({ type: "SHORT_REST", day: "2026-11-03", restMinutes: 480, needMinutes: 660 }, "Tuesday, November 3, 2026")).toBe(
      "Only 8 h of rest before work on Tuesday, November 3, 2026. At least 11 h is required.",
    );
    expect(describeIssue({ type: "LONG_SHIFT", day: "2026-11-02", workedMinutes: 645, limitMinutes: 600 }, "Monday, November 2, 2026")).toBe(
      "Worked 10 h 45 min on Monday, November 2, 2026. The most allowed is 10 h.",
    );
  });
});
