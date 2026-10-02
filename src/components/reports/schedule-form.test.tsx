// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const createSchedule = vi.fn(async (_input: unknown) => ({ success: true, data: {} }));
const updateSchedule = vi.fn(async (_input: unknown) => ({ success: true, data: {} }));

vi.mock("@/actions/report.actions", () => ({
  createSchedule: (i: unknown) => createSchedule(i),
  updateSchedule: (i: unknown) => updateSchedule(i),
  deleteSchedule: vi.fn(async () => ({ success: true, data: {} })),
  checkEmailConfigured: vi.fn(async () => ({ success: true, data: { configured: true } })),
}));

import { ScheduleForm } from "./schedule-form";

const open = (props: Partial<React.ComponentProps<typeof ScheduleForm>> = {}) =>
  render(<ScheduleForm reportId="r1" onClose={() => {}} onSaved={() => {}} {...props} />);

const pick = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

async function addEmailAndSave(email = "hr@example.com") {
  fireEvent.change(screen.getByPlaceholderText("name@company.com"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
  await waitFor(() => expect(createSchedule.mock.calls.length + updateSchedule.mock.calls.length).toBeGreaterThan(0));
}

beforeEach(() => {
  createSchedule.mockClear();
  updateSchedule.mockClear();
});
afterEach(cleanup);

describe("ScheduleForm", () => {
  it("offers every frequency HR asked for", () => {
    open();
    const labels = Array.from((screen.getByLabelText("Frequency") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(labels).toEqual([
      "Daily",
      "Weekly",
      "Twice a month (1st and 15th)",
      "Monthly",
      "First day of the month",
      "Last day of the month",
      "Yearly",
      "Custom (advanced)",
    ]);
  });

  it("saves a daily schedule at the default 8:00 AM Eastern", async () => {
    open();
    await addEmailAndSave();
    expect(createSchedule).toHaveBeenCalledWith({
      reportId: "r1",
      cronExpr: "0 8 * * *",
      timezone: "America/New_York",
      format: "XLSX",
      recipients: ["hr@example.com"],
    });
  });

  it("saves the last day of the month, in the evening", async () => {
    open();
    pick("Frequency", "last");
    fireEvent.click(screen.getByRole("button", { name: "PM" }));
    await addEmailAndSave();
    expect((createSchedule.mock.calls[0][0] as { cronExpr: string }).cronExpr).toBe("0 20 L * *");
  });

  it("saves the first day of the month", async () => {
    open();
    pick("Frequency", "first");
    await addEmailAndSave();
    expect((createSchedule.mock.calls[0][0] as { cronExpr: string }).cronExpr).toBe("0 8 1 * *");
  });

  it("saves a weekly schedule on the chosen day", async () => {
    open();
    pick("Frequency", "weekly");
    pick("Day", "5");
    await addEmailAndSave();
    expect((createSchedule.mock.calls[0][0] as { cronExpr: string }).cronExpr).toBe("0 8 * * 5");
  });

  it("saves a yearly schedule and trims the day to the month's length", async () => {
    open();
    pick("Frequency", "yearly");
    pick("Month", "3");
    pick("Day", "31");
    // Switching to February cannot keep day 31.
    pick("Month", "2");
    expect((screen.getByLabelText("Day") as HTMLSelectElement).value).toBe("29");
    pick("Month", "3");
    pick("Day", "15");
    await addEmailAndSave();
    expect((createSchedule.mock.calls[0][0] as { cronExpr: string }).cronExpr).toBe("0 8 15 3 *");
  });

  it("reads a saved last day schedule back into the form", () => {
    open({
      existingSchedule: { id: "s1", cronExpr: "30 20 L * *", timezone: "America/Chicago", format: "CSV", recipients: ["a@b.com"], isActive: true },
    });
    expect((screen.getByLabelText("Frequency") as HTMLSelectElement).value).toBe("last");
    expect((screen.getByLabelText("Time zone") as HTMLSelectElement).value).toBe("America/Chicago");
    expect(screen.getByRole("button", { name: "PM" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("reads a saved yearly schedule back, and keeps an unusual one as custom", () => {
    open({
      existingSchedule: { id: "s1", cronExpr: "0 9 1 1 *", timezone: "America/New_York", format: "CSV", recipients: ["a@b.com"], isActive: true },
    });
    expect((screen.getByLabelText("Frequency") as HTMLSelectElement).value).toBe("yearly");
    cleanup();
    open({
      existingSchedule: { id: "s2", cronExpr: "0 9 * 1 1", timezone: "America/New_York", format: "CSV", recipients: ["a@b.com"], isActive: true },
    });
    expect((screen.getByLabelText("Frequency") as HTMLSelectElement).value).toBe("custom");
  });

  it("says when the next email goes out and what days it covers", () => {
    open({ coverage: { text: "Last month · Sep 1 to Sep 30, 2026", moves: true } });
    expect(screen.getByText(/^Next email:/)).toBeTruthy();
    expect(screen.getByText("Each email covers Last month · Sep 1 to Sep 30, 2026.")).toBeTruthy();
  });

  it("warns when the report's dates are fixed", () => {
    open({ coverage: { text: "Sep 1 to Sep 30, 2026", moves: false } });
    expect(screen.getByText(/do not move, so every email repeats them/)).toBeTruthy();
  });

  it("will not save without a recipient", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
    expect(screen.getByText("Add at least one email address.")).toBeTruthy();
    expect(createSchedule).not.toHaveBeenCalled();
  });
});
