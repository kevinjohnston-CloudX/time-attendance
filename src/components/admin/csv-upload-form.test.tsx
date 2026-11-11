// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const bulk = vi.hoisted(() => vi.fn());
vi.mock("@/actions/admin.actions", () => ({ bulkCreateEmployees: bulk }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { CsvUploadForm } from "./csv-upload-form";

/**
 * Import employees: a file is read in the browser first, and nothing is sent
 * until Import is pressed with a file that read cleanly.
 */
afterEach(cleanup);

function open() {
  render(<CsvUploadForm sites={["Main"]} departments={["Picking"]} ruleSets={["Default"]} />);
  fireEvent.click(screen.getByRole("button", { name: "Import CSV" }));
}
function pick(text: string) {
  const input = screen.getByRole("dialog").querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [new File([text], "people.csv", { type: "text/csv" })] } });
}

describe("CsvUploadForm", () => {
  it("opens as a window with Import held back until a file is read", () => {
    open();
    expect(screen.getByRole("dialog", { name: "Import employees" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("names the missing columns and never sends a file that did not read", async () => {
    open();
    pick("name,employeeCode\nTest Person,X1\n");
    await waitFor(() => expect(screen.getByText(/These columns are missing/)).toBeTruthy());
    expect(screen.getByText("1 row could not be read")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(true);
    expect(bulk).not.toHaveBeenCalled();
  });

  it("counts a clean file on the button", async () => {
    open();
    pick(
      "name,employeeCode,email,role,site,department,ruleSet,hireDate,supervisorCode,wmsId\n" +
        "Ana Ruiz,E1,ana@home.test,EMPLOYEE,Main,Picking,Default,2024-01-02,,W1\n",
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Import 1 employee" })).toBeTruthy());
  });
});
