import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/presence/reads", () => ({ getOnSiteVisitors: vi.fn() }));

import type { VisitorDayRow } from "@/lib/presence/visitor-day.service";
import { inVisitorList } from "./visitors-day";

/** Which visitors each number on the Visitors panel opens. */
const row = (p: Partial<VisitorDayRow>): VisitorDayRow => ({
  id: "v",
  name: "Ana",
  badge: "CL00001",
  company: null,
  visiting: null,
  photoUrl: null,
  pass: null,
  allowed: true,
  endingSoon: false,
  scans: 0,
  firstIn: null,
  lastScan: null,
  refusal: null,
  ...p,
});

describe("visitor lists", () => {
  const inside = new Set(["here"]);
  const here = row({ id: "here", firstIn: "2026-11-17T14:00:00Z" });
  const left = row({ id: "left", firstIn: "2026-11-17T13:00:00Z" });
  const notYet = row({ id: "notyet" });
  const noPass = row({ id: "nopass", allowed: false, refusal: { reason: "VISITOR_EXPIRED", at: "2026-11-17T12:00:00Z", attempts: 2 } });

  it("today: not inside is allowed in and not in the building now, whether they left or never came", () => {
    const out = [here, left, notYet, noPass].filter((r) => inVisitorList(r, "visitors-outside", inside)).map((r) => r.id);
    expect(out).toEqual(["left", "notyet"]);
  });

  it("a past day: never came is allowed in with no entry", () => {
    const out = [here, left, notYet].filter((r) => inVisitorList(r, "visitors-outside", null)).map((r) => r.id);
    expect(out).toEqual(["notyet"]);
  });

  it("allowed, came in and refused each list their own", () => {
    const all = [here, left, notYet, noPass];
    expect(all.filter((r) => inVisitorList(r, "visitors-allowed", inside)).map((r) => r.id)).toEqual(["here", "left", "notyet"]);
    expect(all.filter((r) => inVisitorList(r, "visitors-came", inside)).map((r) => r.id)).toEqual(["here", "left"]);
    expect(all.filter((r) => inVisitorList(r, "visitors-refused", inside)).map((r) => r.id)).toEqual(["nopass"]);
  });
});
