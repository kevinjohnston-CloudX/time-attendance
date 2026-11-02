// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const updateJobTitle = vi.fn();
vi.mock("@/actions/job-title.actions", () => ({ createJobTitle: vi.fn(), updateJobTitle: (i: unknown) => updateJobTitle(i), deleteJobTitle: vi.fn() }));
vi.mock("@/components/layout/navigation-progress", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

import { ViewOnly } from "./view-only";
import { DeleteSection, EditorPage, Section } from "./editor-page";
import { JobTitlesManager } from "../job-titles-manager";

// The setup frame sizes its rail from a media query, which jsdom does not have.
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as never;
// A field inside a switched-off fieldset is off without its own disabled flag.
const off = (el: Element | null) => !!el && el.matches(":disabled");

const titles = [{ id: "j1", name: "Warehouse Associate", externalId: "WA1", isActive: true, _count: { employees: 0 } }];

describe("View only (Rule Sets or Sites on Read)", () => {
  afterEach(cleanup);

  it("a list: no Add, and a record opens with its fields off and Close in place of Save", () => {
    render(
      <ViewOnly>
        <JobTitlesManager jobTitles={titles} />
      </ViewOnly>,
    );
    expect(screen.queryByRole("button", { name: /Add job title/ })).toBeNull();

    fireEvent.click(screen.getByText("Warehouse Associate"));
    const dialog = screen.getByRole("dialog");
    expect(off(dialog.querySelector('input[name="name"]'))).toBe(true);
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
    expect(screen.getByText("View only")).toBeTruthy();

    fireEvent.submit(dialog.querySelector("form")!);
    expect(updateJobTitle).not.toHaveBeenCalled();
    // The one at the foot, where Cancel and Save were (the X in the corner is also Close).
    fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the same list for someone who may change it still offers Add and Save", () => {
    render(<JobTitlesManager jobTitles={titles} />);
    expect(screen.getAllByRole("button", { name: /Add job title/ }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Warehouse Associate"));
    expect(off(screen.getByRole("dialog").querySelector('input[name="name"]'))).toBe(false);
    expect(screen.getByRole("button", { name: /^Save/ })).toBeTruthy();
  });

  it("an editor page: fields off, no Save, and no Delete section or rail entry", () => {
    const onSubmit = vi.fn();
    render(
      <ViewOnly>
        <EditorPage
          noun="shift"
          title="Days"
          subtitle=""
          back={{ href: "/admin/rules-setup?tab=shifts", label: "Rules Setup" }}
          groups={[
            { title: "Shift", areas: [{ id: "times", label: "Times" }] },
            { title: "Other", areas: [{ id: "delete", label: "Delete shift" }] },
          ]}
          isNew={false}
          submitLabel="Save shift"
          pending={false}
          error={null}
          savedCount={0}
          onSubmit={onSubmit}
        >
          <Section id="times" title="Times" hint="When it starts.">
            <input name="startTime" aria-label="Start" defaultValue="08:00" />
          </Section>
          <DeleteSection title="Delete shift" reason="Nobody is on this shift." />
        </EditorPage>
      </ViewOnly>,
    );
    expect(off(screen.getByLabelText("Start"))).toBe(true);
    expect(screen.queryByRole("button", { name: "Save shift" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Delete shift" })).toBeNull();
    expect(screen.queryByText("Delete shift")).toBeNull();
    expect(screen.getByText("View only")).toBeTruthy();
    fireEvent.submit(screen.getByLabelText("Start").closest("form")!);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
