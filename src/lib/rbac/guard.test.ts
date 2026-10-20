import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
import { alreadyInUse } from "./guard";

/** A duplicate as the Postgres driver adapter reports it: the fields arrive quoted. */
const duplicate = (fields: string[]) =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { driverAdapterError: { cause: { kind: "UniqueConstraintViolation", constraint: { fields } } } },
  });

describe("A save refused for a value already in use", () => {
  it("names a Badge ID (Fidelia Rios, 639608)", () => {
    expect(alreadyInUse(duplicate(['"tenantId"', '"employeeCode"']))).toBe("That Badge ID is already in use.");
  });
  it("names a login email", () => {
    expect(alreadyInUse(duplicate(['"email"']))).toBe("That email is already in use.");
  });
  it("reads the older target list too", () => {
    const err = new Prisma.PrismaClientKnownRequestError("x", { code: "P2002", clientVersion: "test", meta: { target: ["barcode"] } });
    expect(alreadyInUse(err)).toBe("That badge barcode is already in use.");
  });
  it("says it plainly when the field is not one people know", () => {
    expect(alreadyInUse(duplicate(['"timesheetId"', '"bucket"']))).toBe("One of these details is already in use on another record.");
  });
});
