import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/presence/photos", () => ({ photoUrls: vi.fn() }));

import { photoCutoff, retentionCutoff } from "./retention";

describe("retentionCutoff", () => {
  const now = new Date("2026-11-04T15:00:00Z");

  it("keeps a leaver through the end of the last year of the period", () => {
    const cutoff = retentionCutoff(6, now);
    expect(cutoff.toISOString()).toBe("2020-01-01T00:00:00.000Z");
    // Left on the last day of 2019: kept through 2025, due now.
    expect(new Date("2019-12-31T00:00:00Z") < cutoff).toBe(true);
    // Left on the first day of 2020: kept through 2026, not due yet.
    expect(new Date("2020-01-01T00:00:00Z") < cutoff).toBe(false);
  });

  it("follows the country's period", () => {
    expect(retentionCutoff(7, now).getUTCFullYear()).toBe(2019);
  });
});

describe("photoCutoff", () => {
  it("is that many days before now", () => {
    expect(photoCutoff(30, new Date("2026-11-04T15:00:00Z")).toISOString()).toBe("2026-10-05T15:00:00.000Z");
  });
});
