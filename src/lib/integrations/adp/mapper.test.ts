import { describe, expect, it } from "vitest";
import { clearsTerminationDate } from "./mapper";

const now = new Date("2026-11-05T15:00:00Z");
const past = new Date("2026-08-01T00:00:00Z");
const ahead = new Date("2026-11-20T00:00:00Z");

describe("clearsTerminationDate", () => {
  it("clears the old date when ADP rehires someone", () => {
    expect(clearsTerminationDate({ isActive: false, terminatedAt: past }, true, now)).toBe(true);
  });
  it("clears a past date left on someone already active", () => {
    expect(clearsTerminationDate({ isActive: true, terminatedAt: past }, true, now)).toBe(true);
  });
  it("keeps a date still ahead (a notice period)", () => {
    expect(clearsTerminationDate({ isActive: true, terminatedAt: ahead }, true, now)).toBe(false);
  });
  it("never clears for someone ADP has inactive, or with no date", () => {
    expect(clearsTerminationDate({ isActive: false, terminatedAt: past }, false, now)).toBe(false);
    expect(clearsTerminationDate({ isActive: true, terminatedAt: null }, true, now)).toBe(false);
  });
});
