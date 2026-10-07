// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PresencePerson } from "@/lib/presence/types";

const { getOnSiteMovements, getOnSiteScanLog, saved, printed } = vi.hoisted(() => ({
  getOnSiteMovements: vi.fn(),
  getOnSiteScanLog: vi.fn(),
  saved: [] as { name: string; blob: Blob }[],
  printed: [] as string[],
}));
vi.mock("@/lib/presence/reads", () => ({ getOnSiteMovements, getOnSiteScanLog }));
// The profile card's action file signs in through next-auth, which a unit test cannot load.
vi.mock("@/actions/presence.actions", () => ({}));
vi.mock("./export-table", async (orig) => {
  const real = await orig<typeof import("./export-table")>();
  return {
    ...real,
    saveFile: (blob: Blob, name: string) => saved.push({ blob, name }),
    printSheet: (html: string) => printed.push(html),
  };
});

import { ExportWindow } from "./export-window";
import { peopleTable, printHtml, selectPeople, toCsv } from "./export-table";

const NOW = "2026-10-06T13:41:00.000Z"; // 9:41 AM Eastern

function person(over: Partial<PresencePerson>): PresencePerson {
  return {
    id: over.name ?? "x",
    name: "Someone",
    employeeCode: "100000",
    departmentId: "d1",
    department: "Picking",
    jobTitle: null,
    shiftId: "s1",
    shift: "First",
    photoUrl: null,
    salaried: false,
    status: "WORKING",
    inside: true,
    breakKind: null,
    outsideOnMeal: false,
    since: "2026-10-06T10:58:00.000Z",
    firstInToday: "2026-10-06T10:58:00.000Z",
    scheduledStart: "07:00",
    scheduledEnd: "15:30",
    lateMinutes: null,
    inactive: false,
    homeSite: null,
    elsewhere: null,
    gate: { inside: true, at: "2026-10-06T10:58:00.000Z", automatic: false },
    clock: { state: "WORK", at: "2026-10-06T11:00:00.000Z", automatic: false },
    ...over,
  };
}

const PEOPLE = [
  person({ name: "Ana Leal", employeeCode: "116887", department: "Packing", departmentId: "d2" }),
  person({ name: "Jose Brito" }),
  person({ name: "Maria Lunch", status: "ON_MEAL", breakKind: "MEAL", clock: { state: "MEAL", at: "2026-10-06T16:00:00.000Z", automatic: false } }),
  person({ name: "Off Clock Olga", status: "OFF_CLOCK", clock: { state: "OUT", at: "2026-10-06T12:00:00.000Z", automatic: false } }),
  person({ name: "Gone Gary", status: "LEFT", inside: false, gate: { inside: false, at: "2026-10-06T12:30:00.000Z", automatic: false }, clock: { state: "OUT", at: "2026-10-06T12:29:00.000Z", automatic: false } }),
  person({ name: "Late Larry", status: "NOT_ARRIVED", inside: false, gate: null, clock: null, since: null, firstInToday: null }),
];

const site = { id: "site1", name: "0299 Rutherford", timezone: "America/New_York", hasGateData: true };
const screenBuild = vi.fn(async () => null);

const open = (over: Partial<React.ComponentProps<typeof ExportWindow>> = {}) =>
  render(
    <ExportWindow
      site={site}
      people={PEOPLE}
      generatedAt={NOW}
      today="2026-10-06"
      initialDepartmentId=""
      initialShiftId=""
      initialDay=""
      screen={{ label: "The People list", build: screenBuild }}
      canOpenReports
      onClose={() => {}}
      {...over}
    />,
  );

beforeEach(() => {
  saved.length = 0;
  printed.length = 0;
  getOnSiteMovements.mockReset();
  getOnSiteScanLog.mockReset();
});
afterEach(cleanup);

describe("who is on each list", () => {
  const scope = { departmentId: "", shiftId: "", includeBreaks: false };
  it("in the building is the board's own building total", () => {
    expect(selectPeople(PEOPLE, "inside", scope).map((p) => p.name)).toEqual(["Ana Leal", "Jose Brito", "Maria Lunch", "Off Clock Olga"]);
  });
  it("clocked in is the time clock's working people, meals and breaks only when asked", () => {
    expect(selectPeople(PEOPLE, "clocked", scope).map((p) => p.name)).toEqual(["Ana Leal", "Jose Brito"]);
    expect(selectPeople(PEOPLE, "clocked", { ...scope, includeBreaks: true }).map((p) => p.name)).toEqual(["Ana Leal", "Jose Brito", "Maria Lunch"]);
  });
  it("leaves out a clock in the system wrote by itself", () => {
    const auto = person({ name: "Auto", clock: { state: "WORK", at: NOW, automatic: true } });
    expect(selectPeople([auto], "clocked", scope)).toEqual([]);
  });
  it("narrows by department", () => {
    expect(selectPeople(PEOPLE, "everyone", { ...scope, departmentId: "d2" }).map((p) => p.name)).toEqual(["Ana Leal"]);
  });
});

describe("the files", () => {
  const table = () =>
    peopleTable({ people: PEOPLE, set: "inside", scope: { departmentId: "", shiftId: "", includeBreaks: false }, order: "department", site: site.name, tz: site.timezone, generatedAt: NOW, hasGateData: true, filters: [] });

  it("a roll call prints a tick box per person, grouped by department, with a line to sign", () => {
    const html = printHtml(table());
    expect(html).toContain("<h1>In the building</h1>");
    expect(html).toContain("Tue, Oct 6, 2026 at 9:41 AM");
    expect(html.match(/class="tick"><span>/g)?.length).toBe(4);
    expect(html).toContain("Packing <span>1</span>");
    expect(html).toContain("Picking <span>3</span>");
    expect(html).toContain("Checked by");
    expect(html).toContain("____ of 4 people");
  });

  it("escapes names so a name can never become page markup", () => {
    const evil = person({ name: '<img src=x onerror="alert(1)">' });
    const html = printHtml(peopleTable({ people: [evil], set: "inside", scope: { departmentId: "", shiftId: "", includeBreaks: false }, order: "name", site: "S", tz: site.timezone, generatedAt: NOW, hasGateData: true, filters: [] }));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("CSV starts with a byte order mark and keeps formulas as text", () => {
    const t = { ...table(), rows: [["=SUM(A1)", "a,b", 'say "hi"']], columns: ["A", "B", "C"] };
    expect(toCsv(t)).toBe('﻿A,B,C\r\n\'=SUM(A1),"a,b","say ""hi"""');
  });

  it("times are on a 12 hour clock in the building's zone", () => {
    const row = table().rows.find((r) => r[0] === "Jose Brito")!;
    expect(row[5]).toBe("6:58 AM");
  });
});

describe("Export window", () => {
  it("offers the lists with live counts and starts on who is in the building", () => {
    open();
    expect((screen.getByRole("radio", { name: /In the building now/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText("4 people")).toBeTruthy(); // in the building
    expect(screen.getByLabelText("2 people")).toBeTruthy(); // clocked in
    expect(screen.getByLabelText("6 people")).toBeTruthy(); // everyone
    // The preview is the real list: its count and its first names.
    expect(screen.getByTestId("preview-count").textContent).toBe("4");
    expect(screen.getByText("Ana Leal")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Print list" })).toBeTruthy();
  });

  it("prints the roll call", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Print list" }));
    await waitFor(() => expect(printed.length).toBe(1));
    expect(printed[0]).toContain("<h1>In the building</h1>");
  });

  it("counts people on a meal or break into Clocked in only when ticked", () => {
    open();
    fireEvent.click(screen.getByRole("radio", { name: /Clocked in now/ }));
    expect(screen.getByTestId("preview-count").textContent).toBe("2");
    fireEvent.click(screen.getByLabelText("Include people on a meal or break"));
    expect(screen.getByTestId("preview-count").textContent).toBe("3");
  });

  it("downloads Excel and CSV with the building and the time in the name", async () => {
    open();
    fireEvent.click(screen.getByRole("radio", { name: /Everyone today/ }));
    fireEvent.click(screen.getByRole("button", { name: "CSV" }));
    expect(screen.getByText("Everyone today 0299 Rutherford 2026-10-06 941AM.csv")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    await waitFor(() => expect(saved.length).toBe(1));
    expect(saved[0].name).toBe("Everyone today 0299 Rutherford 2026-10-06 941AM.csv");
    const text = await saved[0].blob.text();
    expect(text.split("\r\n").length).toBe(7);
  });

  it("will not export an empty list, and says why", () => {
    open({ people: [PEOPLE[5]] });
    expect((screen.getByRole("button", { name: "Print list" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(/No one is on this list right now/);
  });

  it("starts from the filters on screen", () => {
    open({ initialDepartmentId: "d2" });
    expect((screen.getByLabelText("Department") as HTMLSelectElement).value).toBe("d2");
    expect(screen.getByTestId("preview-count").textContent).toBe("1");
  });

  it("loads the scan log for the day picked, and offers only the last seven days", async () => {
    getOnSiteScanLog.mockResolvedValue({ success: true, data: { rows: [], hasMore: false, day: "2026-10-04", today: "2026-10-06" } });
    open();
    fireEvent.click(screen.getByRole("radio", { name: /^Scan log/ }));
    const day = screen.getByLabelText("Day") as HTMLSelectElement;
    expect(day.options.length).toBe(7);
    fireEvent.change(day, { target: { value: "2026-10-04" } });
    fireEvent.click(screen.getByRole("button", { name: "Print scan log" }));
    await waitFor(() => expect(printed.length).toBe(1));
    expect(getOnSiteScanLog.mock.calls[0][0]).toMatchObject({ siteId: "site1", day: "2026-10-04", limit: 5000 });
    expect(screen.getByRole("link", { name: "Reports" })).toBeTruthy();
  });

  it("says plainly when a day could not be loaded, and stays open", async () => {
    getOnSiteMovements.mockResolvedValue({ success: false, error: "INTERNAL" });
    const onClose = vi.fn();
    open({ onClose });
    fireEvent.click(screen.getByRole("radio", { name: /^Movements/ }));
    fireEvent.click(screen.getByRole("button", { name: "Print movements" }));
    expect(await screen.findByText(/could not be loaded/)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("exports what is on screen through the board's own builder", async () => {
    screenBuild.mockResolvedValueOnce({ title: "Live Attendance", site: "S", when: "w", fileStem: "f", columns: ["A"], rows: [["1"]], filters: [], unit: { one: "person", many: "people" } } as never);
    open();
    fireEvent.click(screen.getByRole("radio", { name: /What is on screen/ }));
    expect(screen.queryByLabelText("Department")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Print view" }));
    await waitFor(() => expect(printed.length).toBe(1));
    expect(screenBuild).toHaveBeenCalled();
  });

  it("has no In the building list where there are no gate readers", () => {
    open({ site: { ...site, hasGateData: false } });
    expect(screen.queryByRole("radio", { name: /In the building now/ })).toBeNull();
    expect((screen.getByRole("radio", { name: /Clocked in now/ }) as HTMLInputElement).checked).toBe(true);
  });
});
