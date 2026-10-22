import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("./check-permission", () => ({}));
vi.mock("./permission-resolver", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));
import { publicError } from "./guard";
import { ACTION_ERROR_TEXT } from "@/lib/action-errors";

describe("what a failed change says", () => {
  it("says a thrown code in words, keeping the code beside it", () => {
    expect(publicError(new Error("FORBIDDEN"))).toEqual({ success: false, error: ACTION_ERROR_TEXT.FORBIDDEN, code: "FORBIDDEN" });
    expect(publicError(new Error("Tenant context required"))).toEqual({ success: false, error: ACTION_ERROR_TEXT.NO_COMPANY, code: "NO_COMPANY" });
  });

  it("keeps an action's own sentence", () => {
    expect(publicError(new Error("This timecard is locked."))).toEqual({ success: false, error: "This timecard is locked." });
  });

  it("names the field of a form check", () => {
    const parsed = z.object({ payRate: z.number() }).safeParse({ payRate: Number("x") });
    expect(publicError(parsed.error).error).toBe("Pay rate must be a number.");
  });

  it("says a record changed meanwhile, not 'Not found'", () => {
    const err = new Prisma.PrismaClientKnownRequestError("No record was found for an update.", { code: "P2025", clientVersion: "7" });
    expect(publicError(err)).toMatchObject({ error: ACTION_ERROR_TEXT.NOT_FOUND, code: "NOT_FOUND" });
  });

  it("never shows a database message", () => {
    expect(publicError(new Error('insert into "Punch" violates foreign key')).error).toMatch(/^Something went wrong\. Reference [0-9A-F]{8}$/);
  });
});
