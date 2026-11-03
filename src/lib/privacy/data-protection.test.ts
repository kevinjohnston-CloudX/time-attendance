import { describe, expect, it, vi } from "vitest";

const findEmployee = vi.fn();
const findLeaveType = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    employee: { findUnique: (...a: unknown[]) => findEmployee(...a) },
    leaveType: { findUnique: (...a: unknown[]) => findLeaveType(...a) },
  },
}));

import { leaveTypeTakesNoNote, noteKeptOut, parseDataProtection } from "./data-protection";

describe("parseDataProtection", () => {
  it("is all off for a company that never set it, as every existing company", () => {
    expect(parseDataProtection(null)).toEqual({ noMedicalNotes: false });
    expect(parseDataProtection({})).toEqual({ noMedicalNotes: false });
    expect(parseDataProtection({ noMedicalNotes: "yes" })).toEqual({ noMedicalNotes: false });
  });

  it("reads the switch when it is on", () => {
    expect(parseDataProtection({ noMedicalNotes: true })).toEqual({ noMedicalNotes: true });
  });
});

describe("leaveTypeTakesNoNote", () => {
  it("only sick leave, only when switched on", () => {
    expect(leaveTypeTakesNoNote({ noMedicalNotes: true }, "SICK")).toBe(true);
    expect(leaveTypeTakesNoNote({ noMedicalNotes: true }, "PTO")).toBe(false);
    expect(leaveTypeTakesNoNote({ noMedicalNotes: false }, "SICK")).toBe(false);
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
