import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodMessage, fieldLabel } from "./zod-message";

const msg = (schema: z.ZodType, value: unknown) => {
  const r = schema.safeParse(value);
  if (r.success) throw new Error("expected a failure");
  return zodMessage(r.error);
};

describe("a form check's failure, in words", () => {
  it("keeps a schema's own message", () => {
    expect(msg(z.object({ name: z.string().min(1, "Give the report a name") }), { name: "" })).toBe("Give the report a name");
  });

  it("names a missing or empty field", () => {
    expect(msg(z.object({ name: z.string() }), {})).toBe("Name is required.");
    expect(msg(z.object({ name: z.string().min(1) }), { name: "" })).toBe("Name is required.");
    expect(msg(z.object({ siteId: z.string().min(1) }), { siteId: "" })).toBe("Site is required.");
  });

  it("says a number is wanted, by the field's name", () => {
    expect(msg(z.object({ payRate: z.number() }), { payRate: Number("abc") })).toBe("Pay rate must be a number.");
    expect(msg(z.object({ payRate: z.number().positive() }), { payRate: 0 })).toBe("Pay rate must be more than 0.");
    expect(msg(z.object({ hours: z.number().max(24) }), { hours: 30 })).toBe("Hours can be at most 24.");
  });

  it("explains dates, choices, lists and lengths", () => {
    expect(msg(z.object({ effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), { effectiveDate: "" })).toBe("Effective date isn't a valid date.");
    expect(msg(z.object({ payType: z.enum(["HOURLY", "SALARY"]) }), { payType: "weekly" })).toBe("Pay type must be one of: HOURLY, SALARY.");
    expect(msg(z.object({ siteIds: z.array(z.string()).min(1) }), { siteIds: [] })).toBe("Sites: pick at least one.");
    expect(msg(z.object({ title: z.string().max(5) }), { title: "too long" })).toBe("Title can be at most 5 characters.");
    expect(msg(z.object({ email: z.email() }), { email: "nope" })).toBe("Email must be an email address.");
  });

  it("says which row of a list", () => {
    expect(msg(z.object({ rows: z.array(z.object({ payRate: z.number() })) }), { rows: [{ payRate: 1 }, { payRate: "x" }] })).toBe("Pay rate (row 2) must be a number.");
  });

  it("turns a field's name into words", () => {
    expect(fieldLabel(["observedDate"])).toBe("Observed date");
    expect(fieldLabel(["wmsId"])).toBe("Badge ID");
    expect(fieldLabel(["agencyId"])).toBe("Agency");
  });
});
