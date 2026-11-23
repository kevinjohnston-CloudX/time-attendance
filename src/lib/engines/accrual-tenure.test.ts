import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
import { serviceMonths } from "./accrual-engine";

// Hire dates are kept at local midnight (04:00 EDT, 05:00 EST); postings at UTC midnight.
const posting = (d: string) => new Date(`${d}T00:00:00Z`);

describe("months of service for an accrual tier", () => {
  it("steps up on the anniversary posting itself (Linda Carmona, hired 11/07/2022 at 05:00)", () => {
    expect(serviceMonths(posting("2026-11-07"), new Date("2022-11-07T05:00:00Z"))).toBe(48);
  });

  it("the same with the summer offset (Francisco Molinares, hired 11/07/2021 at 04:00)", () => {
    expect(serviceMonths(posting("2026-11-07"), new Date("2021-11-07T04:00:00Z"))).toBe(60);
  });

  it("not a day early", () => {
    expect(serviceMonths(posting("2026-11-06"), new Date("2022-11-07T05:00:00Z"))).toBe(47);
  });

  it("a hire date already at midnight UTC counts the same", () => {
    expect(serviceMonths(posting("2026-11-07"), new Date("2022-11-07T00:00:00Z"))).toBe(48);
  });

  it("before the hire day it is zero, and the first month completes a month later", () => {
    expect(serviceMonths(posting("2026-10-24"), new Date("2026-10-22T04:00:00Z"))).toBe(0);
    expect(serviceMonths(posting("2026-11-21"), new Date("2026-10-22T04:00:00Z"))).toBe(0);
    expect(serviceMonths(posting("2026-11-22"), new Date("2026-10-22T04:00:00Z"))).toBe(1);
  });

  it("a hire on the 31st completes its month on the last day of a shorter one", () => {
    expect(serviceMonths(posting("2026-02-28"), new Date("2026-01-31T05:00:00Z"))).toBe(1);
    expect(serviceMonths(posting("2026-02-27"), new Date("2026-01-31T05:00:00Z"))).toBe(0);
  });

  it("agrees with the old count away from the anniversary (Charina Ortega Sanchez, 2/24/2025 to 10/24/2026)", () => {
    expect(serviceMonths(posting("2026-10-23"), new Date("2025-02-24T05:00:00Z"))).toBe(19);
    expect(serviceMonths(posting("2026-10-24"), new Date("2025-02-24T05:00:00Z"))).toBe(20);
  });
});
