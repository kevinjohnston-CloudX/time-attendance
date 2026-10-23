import { describe, expect, it } from "vitest";
import { placeEnteredHours } from "./entered-hours";

const midnight = new Date("2026-10-15T04:00:00Z"); // 12:00 AM Eastern
const at = (h: number) => new Date(midnight.getTime() + h * 3_600_000);

describe("hours entered with Add time on a day", () => {
  it("start at 12:00 AM on a day with none", () => {
    expect(placeEnteredHours(midnight, 480, "reg", [])).toEqual({ start: midnight, end: at(8) });
  });

  it("under another code start where the day's entered hours end, so both show", () => {
    expect(placeEnteredHours(midnight, 240, "holiday", [{ start: midnight, end: at(4), payCodeId: "reg" }])).toEqual({ start: at(4), end: at(8) });
  });

  it("are refused under the same code again (Erika Vera de Romero, 10/15: 8 hours twice)", () => {
    const first = { start: midnight, end: at(8), payCodeId: "reg" };
    expect(placeEnteredHours(midnight, 480, "reg", [first])).toEqual({ refused: "same-code", entry: first });
  });

  it("are refused past 24 hours on the day", () => {
    expect(placeEnteredHours(midnight, 600, "holiday", [{ start: midnight, end: at(16), payCodeId: "reg" }])).toEqual({ refused: "over-24h" });
  });
});
