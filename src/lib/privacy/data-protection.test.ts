import { describe, expect, it, vi } from "vitest";

const findEmployee = vi.fn();
const findLeaveType = vi.fn();
const findTenant = vi.fn();
const findEmployees = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    tenant: { findUnique: (...a: unknown[]) => findTenant(...a) },
    employee: { findUnique: (...a: unknown[]) => findEmployee(...a), findMany: (...a: unknown[]) => findEmployees(...a) },
    leaveType: { findUnique: (...a: unknown[]) => findLeaveType(...a) },
  },
}));

import {
  companyBlocks,
  forgetDataProtection,
  leaveTypeTakesNoNote,
  noteKeptOut,
  parseDataProtection,
  photoOffAt,
  photoOffIds,
  readablePii,
  retentionYears,
} from "./data-protection";

describe("parseDataProtection", () => {
  it("is all off for a company that never set it, as every existing company", () => {
    const off = {
      noMedicalNotes: false,
      anonymise: { enabled: false, deletePhoto: true, deleteDocuments: true, history: "REPLACE" },
      retention: { enabled: false, country: null, years: null },
      leaverPhotos: { enabled: false, days: 30 },
      liveBoardsOff: false,
      clockPhotos: { off: "NONE", siteIds: [] },
    };
    expect(parseDataProtection(null)).toEqual(off);
    expect(parseDataProtection({})).toEqual(off);
    expect(parseDataProtection({ noMedicalNotes: "yes", anonymise: { enabled: "yes" } })).toEqual(off);
    expect(parseDataProtection({ retention: { enabled: "yes", country: "FR", years: 40 }, leaverPhotos: { enabled: 1, days: 7 } })).toEqual(off);
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

describe("retention settings", () => {
  it("reads the country and the period, and falls back to the country's period", () => {
    const r = parseDataProtection({ retention: { enabled: true, country: "NL" } }).retention;
    expect(r).toEqual({ enabled: true, country: "NL", years: null });
    expect(retentionYears(r)).toBe(7);
    expect(retentionYears({ country: "DE", years: 8 })).toBe(8);
    expect(retentionYears({ country: null, years: null })).toBeNull();
    expect(parseDataProtection({ leaverPhotos: { enabled: true, days: 90 } }).leaverPhotos).toEqual({ enabled: true, days: 90 });
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

describe("Live Attendance and time clock photos", () => {
  it("takes nothing away from a company that has not switched anything", async () => {
    forgetDataProtection("t-us");
    findTenant.mockResolvedValueOnce({ dataProtection: null });
    expect(await companyBlocks("t-us", "PRESENCE_VIEW_ANY")).toBe(false);
    expect(await photoOffIds("t-us", ["e1"])).toEqual(new Set());
    expect(findEmployees).not.toHaveBeenCalled();
  });

  it("asks nothing for permissions other than Live Attendance's", async () => {
    findTenant.mockClear();
    expect(await companyBlocks("t-x", "EMPLOYEE_MANAGE")).toBe(false);
    expect(findTenant).not.toHaveBeenCalled();
  });

  it("closes Live Attendance for a company that turned it off, read once a minute", async () => {
    forgetDataProtection("t-eu");
    findTenant.mockClear();
    findTenant.mockResolvedValueOnce({ dataProtection: { liveBoardsOff: true } });
    expect(await companyBlocks("t-eu", "PRESENCE_VIEW_ANY")).toBe(true);
    expect(await companyBlocks("t-eu", "PRESENCE_PHOTO_EDIT")).toBe(true);
    expect(findTenant).toHaveBeenCalledTimes(1);
  });

  it("turns photos off by the person's own site", async () => {
    const some = parseDataProtection({ clockPhotos: { off: "SOME", siteIds: ["de1"] } });
    expect(photoOffAt(some, "de1")).toBe(true);
    expect(photoOffAt(some, "us1")).toBe(false);
    expect(photoOffAt(parseDataProtection({ clockPhotos: { off: "ALL" } }), "us1")).toBe(true);
    expect(photoOffAt(parseDataProtection(null), "de1")).toBe(false);

    forgetDataProtection("t-eu2");
    findTenant.mockResolvedValueOnce({ dataProtection: { clockPhotos: { off: "SOME", siteIds: ["de1"] } } });
    findEmployees.mockResolvedValueOnce([{ id: "e-de" }]);
    expect(await photoOffIds("t-eu2", ["e-de", "e-us"])).toEqual(new Set(["e-de"]));
  });
});
