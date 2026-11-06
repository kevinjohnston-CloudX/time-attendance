import { describe, expect, it } from "vitest";
import { addMonths, lastDayOf, passStanding, renewalStart, termFitsKind } from "./visitor-pass";

describe("lastDayOf", () => {
  it("a day pass ends the day it starts", () => {
    expect(lastDayOf("DAY", "2026-11-06")).toBe("2026-11-06");
  });
  it("a week is seven days counting the first", () => {
    expect(lastDayOf("WEEK", "2026-11-06")).toBe("2026-11-12");
  });
  it("a month ends the day before the same date comes round", () => {
    expect(lastDayOf("MONTH", "2026-11-06")).toBe("2026-12-05");
    expect(lastDayOf("MONTH", "2026-12-15")).toBe("2027-01-14");
  });
  it("frequent lengths", () => {
    expect(lastDayOf("SIX_MONTHS", "2026-11-06")).toBe("2027-05-05");
    expect(lastDayOf("ONE_YEAR", "2026-11-06")).toBe("2027-11-05");
    expect(lastDayOf("TWO_YEARS", "2026-11-06")).toBe("2028-11-05");
  });
  it("a month from the 31st stays inside the next month", () => {
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(lastDayOf("MONTH", "2027-01-31")).toBe("2027-02-27");
  });
});

describe("renewalStart", () => {
  it("an expired pass renews from today", () => {
    expect(renewalStart("2026-11-01", "2026-11-06")).toBe("2026-11-06");
  });
  it("an early renewal keeps the days already given", () => {
    expect(renewalStart("2026-11-10", "2026-11-06")).toBe("2026-11-11");
    expect(renewalStart("2026-11-06", "2026-11-06")).toBe("2026-11-07");
  });
});

describe("passStanding", () => {
  const pass = { siteId: "nj", validFrom: "2026-11-01", validUntil: "2026-11-06", endedAt: null };
  it("valid through the last day, at its building or a tablet that names none", () => {
    expect(passStanding(pass, "2026-11-06", "nj")).toBe("VALID");
    expect(passStanding(pass, "2026-11-01", null)).toBe("VALID");
  });
  it("expired the day after", () => {
    expect(passStanding(pass, "2026-11-07", "nj")).toBe("EXPIRED");
  });
  it("not yet before the first day", () => {
    expect(passStanding(pass, "2026-10-31", "nj")).toBe("NOT_YET");
  });
  it("another building is refused whatever the dates", () => {
    expect(passStanding(pass, "2026-11-03", "ga")).toBe("OTHER_BUILDING");
    expect(passStanding(pass, "2026-11-09", "ga")).toBe("OTHER_BUILDING");
  });
  it("ended outranks everything", () => {
    expect(passStanding({ ...pass, endedAt: new Date() }, "2026-11-03", "nj")).toBe("ENDED");
  });
});

describe("termFitsKind", () => {
  it("a day pass can never be given years", () => {
    expect(termFitsKind("DAY_PASS", "TWO_YEARS")).toBe(false);
    expect(termFitsKind("FREQUENT", "TWO_YEARS")).toBe(true);
    expect(termFitsKind("FREQUENT", "DAY")).toBe(false);
  });
});
