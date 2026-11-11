// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const get = vi.hoisted(() => vi.fn());
const recover = vi.hoisted(() => vi.fn());
vi.mock("@/actions/refused-scans.actions", () => ({ getTimecardRefusedScans: get, recoverTimecardRefusedScans: recover }));

import { RefusedScansNotice } from "./refused-scans-notice";

/**
 * Refused scans: a notice on the timecard opens a review window on the shared
 * frame, grouped by day, with each scan's choice and the add button counting
 * what was picked. Nothing is added until that button is pressed.
 */
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const scans = [
  { id: "a", at: "2026-11-02T13:00:00Z", reader: "Main gate", badgeCode: "1", repeat: false, suggested: "CLOCK_IN" },
  { id: "b", at: "2026-11-02T13:01:00Z", reader: "Main gate", badgeCode: "1", repeat: true, suggested: null },
  { id: "c", at: "2026-11-02T22:00:00Z", reader: "Main gate", badgeCode: "1", repeat: false, suggested: "CLOCK_OUT" },
];

async function openReview() {
  get.mockResolvedValue({ success: true, data: { scans, timezone: "America/New_York" } });
  render(<RefusedScansNotice employeeId="e1" payPeriodId="p1" canEdit onAdded={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Review scans" }));
  return screen.getByRole("dialog", { name: "Refused scans" });
}

describe("RefusedScansNotice", () => {
  it("opens the review as a window, with the suggestions picked and the repeat left out", async () => {
    const dlg = await openReview();
    expect(dlg.textContent).toContain("Monday, Nov 2");
    expect(dlg.textContent).toContain("Repeat tap");
    expect(screen.getByRole("button", { name: "Add 2 punches" })).toBeTruthy();
    expect(recover).not.toHaveBeenCalled();
  });

  it("counts what is picked, and holds the button back when nothing is", async () => {
    await openReview();
    for (const s of screen.getAllByRole("combobox")) fireEvent.change(s, { target: { value: "" } });
    const add = screen.getByRole("button", { name: "Add punches" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(screen.getByText("Nothing picked to add.")).toBeTruthy();
  });

  it("closes on Escape", async () => {
    await openReview();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
