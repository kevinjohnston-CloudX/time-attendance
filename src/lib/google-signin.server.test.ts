import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * A Google sign in: only people HR registered, by an address Google
 * confirmed, never a new person, never a visitor. Each of a person's two
 * emails may bring its own Google account, and a Google account tied to one
 * person never reaches another.
 */

vi.mock("server-only", () => ({}));
const findLoginUserId = vi.fn();
vi.mock("@/lib/login-lookup", () => ({ findLoginUserId: (...a: unknown[]) => findLoginUserId(...a) }));
const db = {
  employee: { findFirst: vi.fn() },
  account: { findUnique: vi.fn(), create: vi.fn() },
};
vi.mock("@/lib/db", () => ({ db }));

const { googleSignIn } = await import("./google-signin.server");

const ACCOUNT = { providerAccountId: "google-sub-personal", access_token: "t", id_token: "i" };
const PERSONAL = { email: "jucamubo99@gmail.com", email_verified: true };
const NONE: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  db.employee.findFirst.mockResolvedValue({ wmsId: null });
  db.account.findUnique.mockResolvedValue(null);
  db.account.create.mockResolvedValue({});
});

describe("googleSignIn", () => {
  it("ties a second Google account to a person who already has one, by their personal email", async () => {
    // The person's work Google account is tied already; it is a different
    // account id, so this one is looked up on its own and found free.
    findLoginUserId.mockResolvedValueOnce("user-juan");
    expect(await googleSignIn(PERSONAL, ACCOUNT, NONE)).toBeNull();
    expect(findLoginUserId).toHaveBeenCalledWith("jucamubo99@gmail.com", { email: true });
    expect(db.account.findUnique).toHaveBeenCalledWith({
      where: { provider_providerAccountId: { provider: "google", providerAccountId: "google-sub-personal" } },
      select: { userId: true },
    });
    expect(db.account.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "user-juan", type: "oauth", provider: "google", providerAccountId: "google-sub-personal" }),
    });
  });

  it("lets a tied account back in without tying it again", async () => {
    findLoginUserId.mockResolvedValueOnce("user-juan");
    db.account.findUnique.mockResolvedValueOnce({ userId: "user-juan" });
    expect(await googleSignIn(PERSONAL, ACCOUNT, NONE)).toBeNull();
    expect(db.account.create).not.toHaveBeenCalled();
  });

  it("refuses a Google account tied to another person, even when the address now points here", async () => {
    findLoginUserId.mockResolvedValueOnce("user-juan");
    db.account.findUnique.mockResolvedValueOnce({ userId: "user-someone-else" });
    expect(await googleSignIn(PERSONAL, ACCOUNT, NONE)).toBe("/login?error=Refused&with=google");
    expect(db.account.create).not.toHaveBeenCalled();
  });

  it("refuses an address Google has not confirmed, without looking anybody up", async () => {
    expect(await googleSignIn({ ...PERSONAL, email_verified: false }, ACCOUNT, NONE)).toBe("/login?error=Refused&with=google");
    expect(await googleSignIn({ email: "x@gmail.com" }, ACCOUNT, NONE)).toBe("/login?error=Refused&with=google");
    expect(await googleSignIn(null, ACCOUNT, NONE)).toBe("/login?error=Refused&with=google");
    expect(findLoginUserId).not.toHaveBeenCalled();
  });

  it("refuses a domain off the allowed list, and lets one on it through", async () => {
    expect(await googleSignIn(PERSONAL, ACCOUNT, ["cloudxsystems.net"])).toBe("/login?error=Refused&with=google");
    expect(findLoginUserId).not.toHaveBeenCalled();
    findLoginUserId.mockResolvedValueOnce("user-juan");
    expect(await googleSignIn(PERSONAL, ACCOUNT, ["cloudxsystems.net", "gmail.com"])).toBeNull();
  });

  it("refuses somebody who is not in CloudTime, and creates nobody", async () => {
    findLoginUserId.mockResolvedValue(null);
    expect(await googleSignIn(PERSONAL, ACCOUNT, NONE)).toBe("/login?error=NotSetUp&with=google");
    expect(db.account.create).not.toHaveBeenCalled();
  });

  it("refuses a visitor", async () => {
    findLoginUserId.mockResolvedValueOnce("user-visitor");
    db.employee.findFirst.mockResolvedValueOnce({ wmsId: "CL00002" });
    expect(await googleSignIn(PERSONAL, ACCOUNT, NONE)).toBe("/login?error=Refused&with=google");
    expect(db.account.create).not.toHaveBeenCalled();
  });

  it("settles two sign ins at once by whoever tied the account first", async () => {
    const clash = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "x" });
    findLoginUserId.mockResolvedValue("user-juan");
    db.account.create.mockRejectedValueOnce(clash);
    db.account.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ userId: "user-juan" });
    expect(await googleSignIn(PERSONAL, ACCOUNT, NONE)).toBeNull();

    db.account.create.mockRejectedValueOnce(clash);
    db.account.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ userId: "user-someone-else" });
    expect(await googleSignIn(PERSONAL, ACCOUNT, NONE)).toBe("/login?error=Refused&with=google");
  });

  it("lets any other database failure surface instead of signing anybody in", async () => {
    findLoginUserId.mockResolvedValueOnce("user-juan");
    db.account.create.mockRejectedValueOnce(new Error("connection lost"));
    await expect(googleSignIn(PERSONAL, ACCOUNT, NONE)).rejects.toThrow("connection lost");
  });
});
