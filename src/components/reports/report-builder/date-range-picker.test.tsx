// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DateRangePicker, describeRange } from "./date-range-picker";
import type { DateRange } from "@/lib/validators/report.schema";

afterEach(cleanup);

const labels = () => screen.getAllByRole("button").map((b) => b.textContent);

const PERIODS = [
  { id: "bw-oct11", startDate: "2026-10-11T17:00:00Z", endDate: "2026-10-25T17:00:00Z", lastDay: "2026-10-24", status: "OPEN", groupName: "NJ Hourly", people: 479 },
  { id: "bw-sep27", startDate: "2026-09-27T17:00:00Z", endDate: "2026-10-11T17:00:00Z", lastDay: "2026-10-10", status: "LOCKED", groupName: "NJ Hourly", people: 470 },
  { id: "wk-oct18", startDate: "2026-10-18T17:00:00Z", endDate: "2026-10-25T17:00:00Z", lastDay: "2026-10-24", status: "OPEN", groupName: "GA Temp", people: 106 },
  { id: "wk-oct11", startDate: "2026-10-11T17:00:00Z", endDate: "2026-10-18T17:00:00Z", lastDay: "2026-10-17", status: "LOCKED", groupName: "GA Temp", people: 104 },
];

describe("DateRangePicker for a scan report", () => {
  it("offers calendar days and no pay period", () => {
    render(<DateRangePicker value={{ type: "yesterday" }} onChange={() => {}} payPeriods={[]} scan />);
    expect(labels()).toEqual(expect.arrayContaining(["Calendar", "Pick dates"]));
    expect(labels()).not.toContain("Pay period");
  });

  it("goes back to yesterday from Pick dates", () => {
    const onChange = vi.fn();
    render(<DateRangePicker value={{ type: "custom", startDate: "", endDate: "" }} onChange={onChange} payPeriods={[]} scan />);
    fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
    expect(onChange).toHaveBeenCalledWith({ type: "yesterday" });
  });

  it("lists every calendar choice in NovaTime's order and reports the pick", () => {
    const onChange = vi.fn();
    const value: DateRange = { type: "calendar", unit: "month", which: "last" };
    render(<DateRangePicker value={value} onChange={onChange} payPeriods={[]} scan />);
    const select = screen.getByLabelText("Which days") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "Today", "Yesterday", "This week", "Last week", "This month", "Last month", "This year", "Last year",
      "The last 7 days", "The last 14 days", "The last 30 days", "The last 60 days", "The last 90 days",
    ]);
    expect(select.value).toBe("last-month");
    fireEvent.change(select, { target: { value: "this-week" } });
    expect(onChange).toHaveBeenCalledWith({ type: "calendar", unit: "week", which: "this" });
    fireEvent.change(select, { target: { value: "days-30" } });
    expect(onChange).toHaveBeenCalledWith({ type: "relative", relativeDays: 30 });
  });

  it("names the company's week, and only for weeks", () => {
    const { rerender } = render(<DateRangePicker value={{ type: "calendar", unit: "week", which: "last" }} onChange={() => {}} payPeriods={[]} scan weekStart={0} />);
    expect(screen.getByText(/Weeks run Sunday to Saturday/)).toBeTruthy();
    rerender(<DateRangePicker value={{ type: "calendar", unit: "week", which: "last" }} onChange={() => {}} payPeriods={[]} scan />);
    expect(screen.getByText(/Weeks run Monday to Sunday/)).toBeTruthy();
    rerender(<DateRangePicker value={{ type: "calendar", unit: "year", which: "last" }} onChange={() => {}} payPeriods={[]} scan />);
    expect(screen.queryByText(/Weeks run/)).toBeNull();
  });
});

describe("DateRangePicker for the other reports", () => {
  it("offers a pay period, calendar days and two dates", () => {
    render(<DateRangePicker value={{ type: "relative", relativeDays: 14 }} onChange={() => {}} payPeriods={PERIODS} />);
    expect(labels()).toEqual(expect.arrayContaining(["Pay period", "Calendar", "Pick dates"]));
  });

  it("goes to last week from Pick dates", () => {
    const onChange = vi.fn();
    render(<DateRangePicker value={{ type: "custom", startDate: "", endDate: "" }} onChange={onChange} payPeriods={PERIODS} />);
    fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
    expect(onChange).toHaveBeenCalledWith({ type: "calendar", unit: "week", which: "last" });
  });

  it("leads the pay period list with the two that move on by themselves", () => {
    const onChange = vi.fn();
    render(
      <DateRangePicker
        value={{ type: "payPeriod", payPeriodId: "bw-oct11", allGroups: true, moving: "current" }}
        onChange={onChange}
        payPeriods={PERIODS}
      />
    );
    const select = screen.getByLabelText("Pay period") as HTMLSelectElement;
    expect(Array.from(select.options).slice(0, 2).map((o) => o.textContent)).toEqual(["Current pay period", "Previous pay period"]);
    expect(select.value).toBe("moving:current");
    fireEvent.change(select, { target: { value: "moving:previous" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ type: "payPeriod", allGroups: true, moving: "previous" }));
  });
});

describe("describeRange", () => {
  it("puts a calendar period in words with its dates", () => {
    expect(describeRange({ type: "calendar", unit: "month", which: "last" }, [])).toMatch(/^Last month · /);
    expect(describeRange({ type: "calendar", unit: "year", which: "this" }, [])).toMatch(/^This year · Jan 1 to Dec 31, \d{4}$/);
  });

  it("names a moving pay period and the dates it stands for today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T16:00:00Z"));
    try {
      const range: DateRange = { type: "payPeriod", payPeriodId: "bw-sep27", allGroups: true, moving: "current" };
      expect(describeRange(range, PERIODS)).toBe("Current pay period · Oct 11 to Oct 24, 2026 · All pay groups");
      expect(describeRange({ ...range, moving: "previous" }, PERIODS)).toBe("Previous pay period · Sep 27 to Oct 10, 2026 · All pay groups");
      expect(describeRange({ ...range, payPeriodId: "wk-oct11", allGroups: false }, PERIODS)).toBe("Current pay period · Oct 18 to Oct 24, 2026 · GA Temp");
    } finally {
      vi.useRealTimers();
    }
  });
});
