// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/actions/admin.actions", () => ({ createSite: vi.fn(), updateSite: vi.fn() }));
vi.mock("@/components/layout/navigation-progress", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

import { SiteDialog, siteLanguages } from "./sites-manager";

const site = {
  id: "s1", tenantId: "t", name: "6002 California", timezone: "America/Los_Angeles", address: null, isActive: true,
  requireGateScan: false, gateScanMode: "OFF", wmsWarehouseId: null, gateAlertsOnSince: null,
  primaryLanguage: "es", additionalLanguages: ["en"], createdAt: new Date(), updatedAt: new Date(),
} as never;

describe("Site languages", () => {
  afterEach(cleanup);

  it("shows the primary and the others, and never offers the primary twice", () => {
    let sent: FormData | null = null;
    render(<SiteDialog site={site} pending={false} error={null} onSubmit={(f) => { sent = f; }} onClose={() => {}} />);
    const primary = screen.getByLabelText(/^Primary language/) as HTMLSelectElement;
    expect(primary.value).toBe("es");
    expect(screen.queryByLabelText("Spanish")).toBeNull();
    expect((screen.getByLabelText("English") as HTMLInputElement).checked).toBe(true);

    // Making English the primary takes it out of the others.
    fireEvent.change(primary, { target: { value: "en" } });
    expect(screen.queryByLabelText("English")).toBeNull();
    fireEvent.click(screen.getByLabelText("Portuguese"));

    fireEvent.submit(primary.form!);
    expect(siteLanguages(sent!)).toEqual({ primaryLanguage: "en", additionalLanguages: ["pt"] });
  });
});
