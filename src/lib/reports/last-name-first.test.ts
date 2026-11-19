import { describe, expect, it } from "vitest";
import { lastNameFirst } from "./last-name-first";

describe("lastNameFirst", () => {
  it("puts the last name first", () => {
    expect(lastNameFirst("Moses Acquah")).toBe("Acquah, Moses");
  });
  it("keeps everything after the first name together, as the time clocks split it", () => {
    expect(lastNameFirst("Sahara Irigoyen Herdoiza")).toBe("Irigoyen Herdoiza, Sahara");
  });
  it("leaves a name already written last name first, and a single name, alone", () => {
    expect(lastNameFirst("Kaur, Jaswinder")).toBe("Kaur, Jaswinder");
    expect(lastNameFirst("Prince")).toBe("Prince");
  });
  it("tidies stray spaces", () => {
    expect(lastNameFirst("  Jonae   Walker ")).toBe("Walker, Jonae");
  });
});
