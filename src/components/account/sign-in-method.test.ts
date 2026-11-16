import { describe, expect, it, vi } from "vitest";

vi.mock("@/actions/profile.actions", () => ({}));
vi.mock("@/actions/password.actions", () => ({}));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("@/components/layout/navigation-progress", () => ({ useRouter: () => ({}) }));

import type { MyProfile } from "@/lib/account/my-profile.service";
import { passwordKeeper, signInMethod } from "./use-my-profile";

const person = (hasPassword: boolean, linkedAccounts: MyProfile["linkedAccounts"]) => ({ hasPassword, linkedAccounts }) as MyProfile;

describe("sign in method in My profile", () => {
  it("names the account people actually sign in with", () => {
    expect(signInMethod(person(true, ["google"]))).toBe("Email and password");
    expect(signInMethod(person(false, ["google"]))).toBe("Google account");
    expect(signInMethod(person(false, ["microsoft"]))).toBe("Microsoft account");
    expect(signInMethod(person(false, ["google", "microsoft"]))).toBe("Google or Microsoft account");
    expect(signInMethod(person(false, []))).toBe("Google or Microsoft account");
    expect(passwordKeeper(person(false, ["microsoft"]))).toBe("Managed by Microsoft");
  });
});
