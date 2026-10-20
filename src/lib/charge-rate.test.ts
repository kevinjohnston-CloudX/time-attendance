import { describe, expect, it } from "vitest";
import { chargeFor } from "./charge-rate";

describe("The charge rate a markup gives", () => {
  it("is the hourly rate plus the markup, to the cent (HR's example)", () => {
    expect(chargeFor(15.92, 32)).toBe(21.01);
  });
  it("matches NovaTime's listed charge rates", () => {
    // Simona Canaan 19.57 at 19.775% is 23.44; Paulett Laje 24 at 22% is 29.28.
    expect(chargeFor(19.57, 19.7751660705161)).toBe(23.44);
    expect(chargeFor(24, 22)).toBe(29.28);
  });
  it("is the hourly rate at no markup", () => {
    expect(chargeFor(18.22, 0)).toBe(18.22);
  });
  it("is nothing without a markup", () => {
    expect(chargeFor(18.22, null)).toBeNull();
  });
});
