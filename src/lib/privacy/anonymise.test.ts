import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/presence/photos", () => ({ removePhoto: vi.fn() }));
vi.mock("@/lib/supabase-storage", () => ({ deleteFromStorage: vi.fn() }));
vi.mock("@/lib/crypto/pii", () => ({ decryptPii: () => null }));

import { anonymisedName, scrubJson } from "./anonymise";

describe("anonymisedName", () => {
  it("keeps the employee code so payroll can still match the hours", () => {
    expect(anonymisedName("100200")).toBe("Former employee 100200");
  });
});

describe("scrubJson", () => {
  const values = ["Ana Pérez", "ana@example.com", "555 0101"];
  const replacement = "Former employee 100200";

  it("replaces the person's details wherever they appear, and nothing else", () => {
    const before = {
      before: { name: "Ana Pérez", email: "ana@example.com" },
      after: { name: "Ana Pérez-Gómez", phone: "555 0101", site: "Main Office", hours: 8 },
      note: ["Corrected for Ana Pérez", null],
    };
    expect(scrubJson(before, values, replacement)).toEqual({
      before: { name: replacement, email: replacement },
      after: { name: `${replacement}-Gómez`, phone: replacement, site: "Main Office", hours: 8 },
      note: [`Corrected for ${replacement}`, null],
    });
  });

  it("leaves the keys and the structure as they were", () => {
    const out = scrubJson({ "Ana Pérez": { punchTime: "2026-11-03T13:00:00Z" } }, values, replacement) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(["Ana Pérez"]);
  });
});
