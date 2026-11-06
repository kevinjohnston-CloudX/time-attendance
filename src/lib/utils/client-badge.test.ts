import { describe, expect, it } from "vitest";
import { NOT_VISITOR, asksForClientBadge, isClientBadge, nextClientBadge, withoutVisitors } from "./client-badge";

describe("isClientBadge", () => {
  it("is a CL badge with digits", () => {
    expect(isClientBadge("CL00001")).toBe(true);
    expect(isClientBadge(" CL123456 ")).toBe(true);
  });

  it("is never a WMS badge, the bare prefix, or nothing", () => {
    expect(isClientBadge("129728")).toBe(false);
    expect(isClientBadge("2672196388")).toBe(false);
    expect(isClientBadge("D1001")).toBe(false);
    expect(isClientBadge("CL")).toBe(false);
    expect(isClientBadge("CLX001")).toBe(false);
    expect(isClientBadge(null)).toBe(false);
    expect(isClientBadge(undefined)).toBe(false);
  });
});

describe("asksForClientBadge", () => {
  it("is CL alone, in any case", () => {
    expect(asksForClientBadge("CL")).toBe(true);
    expect(asksForClientBadge(" cl ")).toBe(true);
  });

  it("is not a badge that is already a number", () => {
    expect(asksForClientBadge("CL00004")).toBe(false);
    expect(asksForClientBadge("129728")).toBe(false);
    expect(asksForClientBadge("")).toBe(false);
    expect(asksForClientBadge(null)).toBe(false);
  });
});

describe("nextClientBadge", () => {
  it("starts at CL00001", () => {
    expect(nextClientBadge([])).toBe("CL00001");
  });

  it("goes one past the highest, gaps included, ignoring other badges", () => {
    expect(nextClientBadge(["CL00001", "CL00007", "CL00003", "129728", null, "D1001"])).toBe("CL00008");
  });

  it("compares numbers, not text", () => {
    expect(nextClientBadge(["CL00009", "CL100000"])).toBe("CL100001");
  });
});

describe("withoutVisitors", () => {
  it("keeps the query whole and adds the visitor exclusion beside it", () => {
    const where = { tenantId: "t1", OR: [{ isActive: true }, { id: "x" }] };
    expect(withoutVisitors(where)).toEqual({ AND: [where, NOT_VISITOR] });
  });

  it("keeps people with no Badge ID (a bare NOT would drop them)", () => {
    expect(NOT_VISITOR.OR).toContainEqual({ wmsId: null });
    expect(NOT_VISITOR.OR).toContainEqual({ NOT: { wmsId: { startsWith: "CL" } } });
  });
});
