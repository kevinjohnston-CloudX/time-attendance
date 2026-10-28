import { beforeEach, describe, expect, it, vi } from "vitest";

// Bergen's layout: Sick Leave has no pay code of its own; SCKNX8NJ hands it
// out as NJ Sick and SICKCA as CA Sick. PTO comes from the leave type's code.
// Bereavement is on no policy. FHOL is a Floating Holiday policy turned off.
const rules = [
  { ptoPolicyId: "SCKNX8NJ", leaveTypeId: "sick", payCodeId: "nj-sick", ptoPolicy: { isActive: true }, leaveType: { payCodeId: null } },
  { ptoPolicyId: "SICKCA", leaveTypeId: "sick", payCodeId: "ca-sick", ptoPolicy: { isActive: true }, leaveType: { payCodeId: null } },
  { ptoPolicyId: "PTONX8NJ", leaveTypeId: "pto", payCodeId: null, ptoPolicy: { isActive: true }, leaveType: { payCodeId: "pto" } },
  { ptoPolicyId: "FHOL", leaveTypeId: "float", payCodeId: null, ptoPolicy: { isActive: false }, leaveType: { payCodeId: "float" } },
];
const categories: Record<string, string[]> = {
  "nj-hourly": ["SCKNX8NJ", "PTONX8NJ"],
  "ca-hourly": ["SICKCA"],
  "nj-exempt": ["FHOL"],
};
const people: Record<string, { payCategoryId: string | null }> = {
  nj: { payCategoryId: "nj-hourly" },
  ca: { payCategoryId: "ca-hourly" },
  exempt: { payCategoryId: "nj-exempt" },
  none: { payCategoryId: null },
};

vi.mock("@/lib/db", () => ({
  db: {
    employee: {
      findUniqueOrThrow: vi.fn(async ({ where, select }: { where: { id: string }; select: Record<string, unknown> }) =>
        select.user
          ? { user: { name: `Person ${where.id}` }, payCategory: { description: "NJ Non Exempt 8" } }
          : { tenantId: "t1", payCategoryId: people[where.id].payCategoryId },
      ),
    },
    ptoPolicyRule: { findMany: vi.fn(async () => rules) },
    payCategoryPtoPolicy: {
      findMany: vi.fn(async ({ where }: { where: { payCategoryId: string } }) =>
        (categories[where.payCategoryId] ?? []).map((ptoPolicyId) => ({ ptoPolicyId })),
      ),
    },
    payCode: { findUniqueOrThrow: vi.fn(async () => ({ label: "CA Sick " })) },
    leaveType: { findUniqueOrThrow: vi.fn(async () => ({ name: "Floating Holiday" })) },
  },
}));

import { assertLeaveTypeAllowed, assertPayCodeAllowed, availabilityFor, leaveTypeAllowed, payCodeAllowed } from "./pay-code-availability";

beforeEach(() => vi.clearAllMocks());

describe("pay codes from leave policies", () => {
  it("gives an NJ employee NJ Sick and not CA Sick, and a California one the reverse", async () => {
    const nj = await availabilityFor("nj");
    const ca = await availabilityFor("ca");
    expect(payCodeAllowed(nj, "nj-sick")).toBe(true);
    expect(payCodeAllowed(nj, "ca-sick")).toBe(false);
    expect(payCodeAllowed(ca, "ca-sick")).toBe(true);
    expect(payCodeAllowed(ca, "nj-sick")).toBe(false);
  });

  it("gives a leave type's own code to those whose policy covers it", async () => {
    expect(payCodeAllowed(await availabilityFor("nj"), "pto")).toBe(true);
    expect(payCodeAllowed(await availabilityFor("ca"), "pto")).toBe(false);
  });

  it("leaves codes no policy hands out to everyone, with or without a pay category", async () => {
    for (const who of ["nj", "ca", "none"]) {
      const a = await availabilityFor(who);
      expect(payCodeAllowed(a, "bereavement")).toBe(true);
      expect(payCodeAllowed(a, "regular")).toBe(true);
      expect(leaveTypeAllowed(a, "unpaid")).toBe(true);
    }
  });

  it("gives nothing from a policy turned off, and does not hand its codes to everyone", async () => {
    expect(payCodeAllowed(await availabilityFor("exempt"), "float")).toBe(false);
    expect(payCodeAllowed(await availabilityFor("nj"), "float")).toBe(false);
  });

  it("gives the Sick Leave type to both, since each has a sick policy", async () => {
    expect(leaveTypeAllowed(await availabilityFor("nj"), "sick")).toBe(true);
    expect(leaveTypeAllowed(await availabilityFor("ca"), "sick")).toBe(true);
    expect(leaveTypeAllowed(await availabilityFor("none"), "sick")).toBe(false);
  });

  it("refuses in words HR can act on", async () => {
    await expect(assertPayCodeAllowed("nj", "ca-sick")).rejects.toThrow(
      "CA Sick isn't on Person nj's leave policies (pay category NJ Non Exempt 8), so it can't go on their timecard.",
    );
    await expect(assertPayCodeAllowed("nj", "nj-sick")).resolves.toBeUndefined();
    await expect(assertLeaveTypeAllowed("ca", "float")).rejects.toThrow("Floating Holiday isn't on Person ca's leave policies");
  });
});
