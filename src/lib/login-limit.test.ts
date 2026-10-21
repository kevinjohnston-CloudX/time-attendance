import { beforeEach, describe, expect, it, vi } from "vitest";

// Wrong passwords in the window, as audit rows: { entityId, ipAddress }.
let failures: { entityId: string; ipAddress: string }[] = [];
vi.mock("@/lib/db", () => ({
  db: {
    auditLog: {
      count: async ({ where }: { where: { entityId?: string; ipAddress?: string } }) =>
        failures.filter((f) => (!where.entityId || f.entityId === where.entityId) && (!where.ipAddress || f.ipAddress === where.ipAddress)).length,
    },
  },
}));

import bcrypt from "bcryptjs";
import { DUMMY_PASSWORD_HASH, isLockedOut, loginKey } from "./login-limit";

const tries = (entityId: string, ipAddress: string, n: number) => {
  for (let i = 0; i < n; i++) failures.push({ entityId, ipAddress });
};

describe("locking a login after wrong passwords", () => {
  beforeEach(() => { failures = []; });

  it("locks the account only where the wrong passwords came from", async () => {
    tries("regina", "1.1.1.1", 5);
    expect(await isLockedOut("regina", "1.1.1.1")).toBe(true);
    // Regina at the office or at home still signs in.
    expect(await isLockedOut("regina", "2.2.2.2")).toBe(false);
  });

  it("locks the account everywhere after 20 wrong passwords from many places", async () => {
    for (let i = 0; i < 20; i++) tries("regina", `9.9.9.${i}`, 1);
    expect(await isLockedOut("regina", "2.2.2.2")).toBe(true);
  });

  it("stops one address working through a list of accounts", async () => {
    for (let i = 0; i < 30; i++) tries(`person${i}`, "1.1.1.1", 1);
    expect(await isLockedOut("someone-new", "1.1.1.1")).toBe(true);
    expect(await isLockedOut("someone-new", "2.2.2.2")).toBe(false);
  });

  it("falls back to five for the account when there is no address", async () => {
    tries("regina", "1.1.1.1", 5);
    expect(await isLockedOut("regina", null)).toBe(true);
  });
});

describe("an email with no password login", () => {
  it("is counted under a hash of what was typed, whatever the capitals, never the text", () => {
    const key = loginKey(null, " Nobody@Example.com ");
    expect(key).toBe(loginKey(null, "nobody@example.com"));
    expect(key).toMatch(/^name:[0-9a-f]{64}$/);
    expect(key).not.toContain("nobody");
    expect(loginKey("user-1", "regina@example.com")).toBe("user-1");
  });

  it("is checked against a password hash as costly as a real one", () => {
    expect(bcrypt.getRounds(DUMMY_PASSWORD_HASH)).toBe(12);
    expect(bcrypt.compareSync("anything", DUMMY_PASSWORD_HASH)).toBe(false);
  });
});
