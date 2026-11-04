import { describe, expect, it, vi } from "vitest";

const findEmployee = vi.fn();
const findLeaveType = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    employee: { findUnique: (...a: unknown[]) => findEmployee(...a) },
    leaveType: { findUnique: (...a: unknown[]) => findLeaveType(...a) },
  },
}));

import { leaveTypeTakesNoNote, noteKeptOut, parseDataProtection, readablePii } from "./data-protection";

describe("parseDataProtection", () => {
  it("is all off for a company that never set it, as every existing company", () => {
    const off = { noMedicalNotes: false, anonymise: { enabled: false, deletePhoto: true, deleteDocuments: true, history: "REPLACE" } };
    expect(parseDataProtection(null)).toEqual(off);
    expect(parseDataProtection({})).toEqual(off);
    expect(parseDataProtection({ noMedicalNotes: "yes", anonymise: { enabled: "yes" } })).toEqual(off);
  });

  it("reads the switch when it is on", () => {
    expect(parseDataProtection({ noMedicalNotes: true }).noMedicalNotes).toBe(true);
    expect(parseDataProtection({ anonymise: { enabled: true, deletePhoto: false, history: "KEEP" } }).anonymise).toEqual({
      enabled: true,
      deletePhoto: false,
      deleteDocuments: true,
      history: "KEEP",
    });
  });
});

describe("leaveTypeTakesNoNote", () => {
  it("only sick leave, only when switched on", () => {
    const on = { ...parseDataProtection(null), noMedicalNotes: true };
    expect(leaveTypeTakesNoNote(on, "SICK")).toBe(true);
    expect(leaveTypeTakesNoNote(on, "PTO")).toBe(false);
    expect(leaveTypeTakesNoNote(parseDataProtection(null), "SICK")).toBe(false);
  });
});

describe("noteKeptOut", () => {
  it("keeps the note for a company with nothing set", async () => {
    findEmployee.mockResolvedValueOnce({ tenant: { dataProtection: null } });
    findLeaveType.mockResolvedValueOnce({ category: "SICK" });
    expect(await noteKeptOut("e1", "lt1")).toBe(false);
  });

  it("leaves the note out of sick leave in a company that switched it on", async () => {
    findEmployee.mockResolvedValueOnce({ tenant: { dataProtection: { noMedicalNotes: true } } });
    findLeaveType.mockResolvedValueOnce({ category: "SICK" });
    expect(await noteKeptOut("e1", "lt1")).toBe(true);
  });
});

describe("readablePii", () => {
  it("reads imported values as typed and encrypted ones through the key", () => {
    const enc = "a".repeat(24) + ":" + "b".repeat(32) + ":c0ffee";
    const out = readablePii({ phone: "555 0101", phone2: enc, city: "  ", name: "x" }, (v) => (v === enc ? "555 0202" : null));
    expect(out).toEqual({ phone: "555 0101", phone2: "555 0202", city: null, name: "x" });
  });
});
