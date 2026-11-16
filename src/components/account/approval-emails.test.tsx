// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * The approval emails switch in My profile on a phone: it shows what is
 * saved, flips at once, saves, and goes back with a message when the save
 * fails, so it never claims a setting the server does not have.
 */

let saved = true;
let failNext = false;
const saves: boolean[] = [];
vi.mock("@/actions/profile.actions", () => ({
  loadMyProfile: async () => ({
    success: true,
    data: { name: "Maria Lopez", username: null, workEmail: "maria@x.com", personalEmail: null, hasPassword: true, approvalEmails: saved, employee: null, badge: null },
  }),
  setApprovalEmails: async (on: boolean) => {
    saves.push(on);
    if (failNext) return { success: false, message: "That setting could not be saved. Try again." };
    saved = on;
    return { success: true };
  },
}));
vi.mock("@/actions/password.actions", () => ({ changeOwnPassword: vi.fn() }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("@/components/layout/navigation-progress", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ children, ...p }: { children: React.ReactNode }) => <a {...p}>{children}</a> }));

import { PhoneProfileScreen } from "./profile-phone";

const open = async () => {
  render(<PhoneProfileScreen onBack={() => {}} onPassword={() => {}} onLeave={() => {}} />);
  return await screen.findByRole("switch", { name: "Approval emails" });
};

describe("approval emails switch", () => {
  afterEach(() => {
    cleanup();
    saved = true;
    failNext = false;
    saves.length = 0;
  });

  it("shows what is saved and turns the emails off", async () => {
    const sw = await open();
    expect(sw.getAttribute("aria-checked")).toBe("true");
    await act(async () => fireEvent.click(sw));
    expect(saves).toEqual([false]);
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("goes back and says so when the save fails", async () => {
    failNext = true;
    const sw = await open();
    await act(async () => fireEvent.click(sw));
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe("That setting could not be saved. Try again.");
  });
});
