import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * My profile reads only the signed in person's own record: the employee row
 * must belong to the same sign in as the session, and pay never leaves.
 */

const state = vi.hoisted(() => ({
  employeeWhere: null as unknown,
  employeeSelect: null as Record<string, unknown> | null,
  row: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: async () => ({ name: "Alex Rivera", username: null, email: "alex@home.test", workEmail: null, passwordHash: "x" }),
    },
    employee: {
      findFirst: async (args: { where: unknown; select: Record<string, unknown> }) => {
        state.employeeWhere = args.where;
        state.employeeSelect = args.select;
        return state.row;
      },
    },
  },
}));
vi.mock("@/lib/crypto/pii", () => ({ decryptPiiFields: <T,>(r: T) => r }));
vi.mock("@/lib/badge/badge.service", () => ({ getIdBadge: async () => null }));

import { getMyProfile } from "./my-profile.service";

const ROW = {
  employeeCode: "D2001",
  wmsId: null,
  isActive: true,
  terminatedAt: null,
  hireDate: new Date("2023-04-17T00:00:00Z"),
  jobTitle: null,
  jobTitleRef: { name: "Picker" },
  department: { name: "Receiving" },
  site: { name: "Demo Warehouse" },
  supervisor: { wmsName: null, user: { name: "Sam Carter" } },
  phone: "555 0100",
  phone2: null,
  address1: "1 Main St",
  address2: null,
  city: "Newark",
  state: "NJ",
  zipCode: "07102",
  country: "US",
};

describe("getMyProfile", () => {
  beforeEach(() => {
    state.row = { ...ROW };
  });

  it("looks the employee up by the session's own employee id and sign in together", async () => {
    await getMyProfile("u1", "e1");
    expect(state.employeeWhere).toEqual({ id: "e1", userId: "u1" });
  });

  it("never selects pay", async () => {
    await getMyProfile("u1", "e1");
    const keys = Object.keys(state.employeeSelect ?? {});
    expect(keys.some((k) => /rate|pay/i.test(k))).toBe(false);
  });

  it("returns no employee details when the row is not this sign in's own", async () => {
    state.row = null;
    const p = await getMyProfile("u1", "someone-else");
    expect(p?.employee).toBeNull();
    expect(p?.name).toBe("Alex Rivera");
  });

  it("writes the address on its lines and the hire date as a calendar date", async () => {
    const p = await getMyProfile("u1", "e1");
    expect(p?.employee?.address).toEqual(["1 Main St", "Newark, NJ 07102"]);
    expect(p?.employee?.hireDate).toBe("2023-04-17");
    expect(p?.employee?.jobTitle).toBe("Picker");
    expect(p?.employee?.supervisor).toBe("Sam Carter");
  });

  it("has no employee section for a sign in with no employee record", async () => {
    const p = await getMyProfile("u1", null);
    expect(p?.employee).toBeNull();
    expect(p?.hasPassword).toBe(true);
  });
});
