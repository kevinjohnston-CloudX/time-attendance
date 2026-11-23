import { describe, expect, it } from "vitest";
import { NO_AGENCY, agencyParam, agencySummary, agencyWhere, inAgencies, parseAgencyIds } from "./agency-filter";

const OPTIONS = [
  { id: "bergen", name: "BERGEN" },
  { id: "nls", name: "National Labor Strategies" },
  { id: "pps", name: "Preferred Personnel Solutions (GA)" },
  { id: "lyneer", name: "Lyneer (CA)" },
  { id: NO_AGENCY, name: "No agency" },
];

describe("the Agency filter", () => {
  it("reads the address's comma list, once each, and writes it back", () => {
    expect(parseAgencyIds("bergen, nls,,bergen")).toEqual(["bergen", "nls"]);
    expect(parseAgencyIds(undefined)).toEqual([]);
    expect(agencyParam(["bergen", NO_AGENCY])).toBe("bergen,none");
  });

  it("takes nothing picked as everybody", () => {
    expect(agencyWhere([])).toEqual({});
    expect(inAgencies([], "anything")).toBe(true);
    expect(inAgencies([], null)).toBe(true);
  });

  it("finds Bergen's people alone", () => {
    expect(agencyWhere(["bergen"])).toEqual({ agencyId: { in: ["bergen"] } });
    expect(inAgencies(["bergen"], "bergen")).toBe(true);
    expect(inAgencies(["bergen"], "nls")).toBe(false);
    expect(inAgencies(["bergen"], null)).toBe(false);
  });

  it("keeps people with no agency when No agency is ticked, as everyone but Bergen does", () => {
    const allButBergen = ["nls", "pps", "lyneer", NO_AGENCY];
    expect(agencyWhere(allButBergen)).toEqual({ OR: [{ agencyId: { in: ["nls", "pps", "lyneer"] } }, { agencyId: null }] });
    expect(inAgencies(allButBergen, null)).toBe(true);
    expect(inAgencies(allButBergen, "bergen")).toBe(false);
    expect(agencyWhere([NO_AGENCY])).toEqual({ agencyId: null });
  });

  it("says what is picked: the names, all but the one left out, or how many", () => {
    expect(agencySummary(["bergen"], OPTIONS)).toBe("BERGEN");
    expect(agencySummary(["nls", "pps", "lyneer", NO_AGENCY], OPTIONS)).toBe("All but BERGEN");
    expect(agencySummary(["nls", "pps", "lyneer"], OPTIONS)).toBe("All but BERGEN, No agency");
    expect(agencySummary(["nls", "pps", "lyneer"], [...OPTIONS, { id: "x", name: "X" }, { id: "y", name: "Y" }])).toBe("3 of 7");
    expect(agencySummary(["gone"], OPTIONS)).toBe("1 selected");
  });
});
