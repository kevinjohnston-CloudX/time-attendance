import { describe, expect, it } from "vitest";
import { shownName, shownNameOrNull } from "./shown-name";

describe("shownName", () => {
  it("shows the WMS name when there is one", () => {
    expect(shownName({ wmsName: " Mary Lopez ", employeeCode: "123456", user: { name: "Maria Lopez" } })).toBe("Mary Lopez");
  });

  it("falls back to the legal name, then the employee code", () => {
    expect(shownName({ wmsName: null, employeeCode: "123456", user: { name: "Maria Lopez" } })).toBe("Maria Lopez");
    expect(shownName({ wmsName: "  ", employeeCode: "123456", user: { name: "Maria Lopez" } })).toBe("Maria Lopez");
    expect(shownName({ employeeCode: "123456", user: null })).toBe("Employee 123456");
  });

  it("says null rather than inventing a name", () => {
    expect(shownNameOrNull({ wmsName: "Mary Lopez", user: { name: "Maria Lopez" } })).toBe("Mary Lopez");
    expect(shownNameOrNull({ user: { name: " " } })).toBeNull();
    expect(shownNameOrNull({})).toBeNull();
  });
});
