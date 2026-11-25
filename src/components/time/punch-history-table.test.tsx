// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Punch } from "@prisma/client";
import { PunchHistoryTable } from "./punch-history-table";

afterEach(cleanup);

/** A punch as the database holds it: an instant, no zone of its own. */
function punch(id: string, iso: string): Punch {
  const at = new Date(iso);
  return {
    id,
    punchTime: at,
    roundedTime: at,
    punchType: "CLOCK_IN",
    source: "WEB",
    isApproved: true,
    correctedById: null,
    correctsId: null,
    note: null,
  } as unknown as Punch;
}

// Eddie Marin's Nov 24 clock in at the 6002 California building (CXT): stored
// as 15:58:08 UTC, which the live server printed as 3:58 PM. Both zones are
// asserted, so this fails on any machine clock if the table goes back to
// printing the server's own time.
describe("Punch Clock and Punch History list", () => {
  it("shows a California punch in California time", () => {
    render(<PunchHistoryTable punches={[punch("a", "2026-11-24T15:58:08Z")]} timeZone="America/Los_Angeles" />);
    expect(screen.getByText("7:58:08 AM")).not.toBeNull();
    expect(screen.getByText("7:58 AM")).not.toBeNull();
  });

  it("shows the same moment in New Jersey time for a New Jersey person", () => {
    render(<PunchHistoryTable punches={[punch("a", "2026-11-24T15:58:08Z")]} timeZone="America/New_York" />);
    expect(screen.getByText("10:58:08 AM")).not.toBeNull();
  });

  it("puts an evening punch on the day it happened there, not the UTC day", () => {
    // 4:40 PM on Nov 23 in California is 12:40 AM on Nov 24 in UTC.
    render(<PunchHistoryTable punches={[punch("a", "2026-11-24T00:40:02Z")]} timeZone="America/Los_Angeles" />);
    expect(screen.getByText("Nov 23")).not.toBeNull();
    expect(screen.getByText("4:40:02 PM")).not.toBeNull();
  });
});
