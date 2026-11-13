import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A Microsoft sign in: only people HR registered, never a new person, never a
 * visitor, and a Microsoft account linked to one person never reaches another.
 */

vi.mock("server-only", () => ({}));
const findLoginUserId = vi.fn();
vi.mock("@/lib/login-lookup", () => ({ findLoginUserId: (...a: unknown[]) => findLoginUserId(...a) }));
const db = {
  employee: { findFirst: vi.fn() },
  account: { findUnique: vi.fn(), create: vi.fn() },
};
vi.mock("@/lib/db", () => ({ db }));

const { microsoftSignIn } = await import("./microsoft-signin.server");

const ACCOUNT = { providerAccountId: "ms-sub-1", access_token: "t", id_token: "i" };
const PROFILE = { preferred_username: "Ana@Hotmail.com" };

beforeEach(() => {
  vi.clearAllMocks();
  db.employee.findFirst.mockResolvedValue({ wmsId: null });
  db.account.findUnique.mockResolvedValue(null);
});

describe("microsoftSignIn", () => {
  it("links and lets in a person HR registered under that address", async () => {
    findLoginUserId.mockResolvedValueOnce("user-ana");
    expect(await microsoftSignIn(PROFILE, ACCOUNT)).toBeNull();
    expect(findLoginUserId).toHaveBeenCalledWith("ana@hotmail.com", { email: true });
    expect(db.account.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "user-ana", provider: "microsoft-entra-id", providerAccountId: "ms-sub-1" }),
    });
  });

  it("lets a linked account back in without linking again", async () => {
    findLoginUserId.mockResolvedValueOnce("user-ana");
    db.account.findUnique.mockResolvedValueOnce({ userId: "user-ana" });
    expect(await microsoftSignIn(PROFILE, ACCOUNT)).toBeNull();
    expect(db.account.create).not.toHaveBeenCalled();
  });

  it("refuses somebody who is not in CloudTime, and creates nobody", async () => {
    findLoginUserId.mockResolvedValue(null);
    expect(await microsoftSignIn(PROFILE, ACCOUNT)).toBe("/login?error=NotSetUp&with=microsoft");
    expect(db.account.create).not.toHaveBeenCalled();
  });

  it("refuses an account already linked to another person", async () => {
    findLoginUserId.mockResolvedValueOnce("user-ana");
    db.account.findUnique.mockResolvedValueOnce({ userId: "user-someone-else" });
    expect(await microsoftSignIn(PROFILE, ACCOUNT)).toBe("/login?error=Refused&with=microsoft");
    expect(db.account.create).not.toHaveBeenCalled();
  });

  it("refuses an email claim on another domain without looking anybody up", async () => {
    const posing = { preferred_username: "x@evil.onmicrosoft.com", email: "juan.munoz@cloudxsystems.net" };
    expect(await microsoftSignIn(posing, ACCOUNT)).toBe("/login?error=Refused&with=microsoft");
    expect(findLoginUserId).not.toHaveBeenCalled();
  });

  it("refuses a visitor", async () => {
    findLoginUserId.mockResolvedValueOnce("user-visitor");
    db.employee.findFirst.mockResolvedValueOnce({ wmsId: "CL00002" });
    expect(await microsoftSignIn(PROFILE, ACCOUNT)).toBe("/login?error=Refused&with=microsoft");
    expect(db.account.create).not.toHaveBeenCalled();
  });

  it("falls back to a same domain email claim when the sign in name is not registered", async () => {
    findLoginUserId.mockResolvedValueOnce(null).mockResolvedValueOnce("user-ana");
    const p = { preferred_username: "alopez@bergen.com", email: "ana.lopez@bergen.com" };
    expect(await microsoftSignIn(p, ACCOUNT)).toBeNull();
    expect(findLoginUserId).toHaveBeenNthCalledWith(2, "ana.lopez@bergen.com", { email: true });
  });
});
