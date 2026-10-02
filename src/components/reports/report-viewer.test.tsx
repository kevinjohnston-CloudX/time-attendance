// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { runReport } = vi.hoisted(() => ({ runReport: vi.fn() }));
vi.mock("@/actions/report.actions", () => ({
  runReport,
  deleteReport: vi.fn(),
  duplicateReport: vi.fn(),
  toggleSchedule: vi.fn(),
  createSchedule: vi.fn(),
  updateSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  checkEmailConfigured: vi.fn(async () => ({ success: true, data: { configured: true } })),
}));
vi.mock("@/components/layout/navigation-progress", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

import { ReportViewer } from "./report-viewer";

const report = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  name: "Time clock report",
  description: null,
  dataSource: "TIME_CLOCK_SCAN",
  config: { columns: ["firstName", "hours"], filters: [], groupBy: [], sortBy: [], dateRange: { type: "calendar", unit: "month", which: "last" }, limit: 50000 },
  visibility: "PRIVATE",
  isTemplate: false,
  owner: { id: "u1", name: "Juan" },
  shares: [],
  schedules: [{ id: "s1", cronExpr: "0 20 L * *", isActive: true, format: "CSV", recipients: ["abby@example.com"], timezone: "America/New_York" }],
  runs: [],
  access: { isOwner: true, canEdit: true },
  ...over,
});

const source = { columns: [{ id: "firstName", label: "First name" }, { id: "hours", label: "Hours" }], filters: [] };
const options = { payPeriods: [], sites: [], departments: [], leaveTypes: [] };

beforeEach(() => {
  runReport.mockReset();
  runReport.mockResolvedValue({ success: true, data: { columns: [{ id: "firstName", label: "First name", type: "string" }], rows: [{ firstName: "Maria" }], totalRows: 1 } });
});
afterEach(cleanup);

const open = (r = report()) => render(<ReportViewer report={r as never} filterOptions={options as never} source={source as never} />);

describe("saved scan report page", () => {
  it("downloads with the moving period, so a bookmarked link is always current", () => {
    open();
    for (const [label, fmt] of [["Excel", "xlsx"], ["CSV", "csv"], ["PDF", "pdf"]]) {
      const href = (screen.getByTitle(`Download as ${label}`) as HTMLAnchorElement).getAttribute("href")!;
      const url = new URL(href, "http://x");
      expect(url.pathname).toBe("/api/reports/r1/export");
      expect(url.searchParams.get("format")).toBe(fmt);
      expect(JSON.parse(url.searchParams.get("range")!)).toEqual({ type: "calendar", unit: "month", which: "last" });
    }
  });

  it("shows the saved dates in words and offers the scan choices, not pay periods", () => {
    open();
    expect(screen.getAllByText(/^Last month · /).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Week, month or year" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pay period" })).toBeNull();
  });

  it("runs with the dates on screen", async () => {
    open();
    fireEvent.click(screen.getAllByRole("button", { name: /Run report/ })[0]);
    await waitFor(() => expect(runReport).toHaveBeenCalled());
    expect(runReport.mock.calls[0][0]).toEqual({ reportId: "r1", dateRangeOverride: { type: "calendar", unit: "month", which: "last" } });
  });

  it("describes a last day of the month schedule in words", () => {
    open();
    expect(screen.getByText(/On the last day of each month at 8:00 PM/)).toBeTruthy();
  });

  it("tells the schedule form what each email will cover", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /Edit schedule/ }));
    expect(screen.getByText(/^Each email covers Last month · /)).toBeTruthy();
    expect(screen.getByText(/^Next email:/)).toBeTruthy();
    expect((screen.getByLabelText("Frequency") as HTMLSelectElement).value).toBe("last");
  });
});
