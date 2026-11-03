import { describe, expect, it } from "vitest";
import { isSignInOnlyRole, isVisitorRole, seesTeam } from "./sign-in-only";

// The roles as they are set up in the company on 10/29.
const agencyViewer = { isSystem: false, permissions: [
  { resource: "employee", action: "read", scope: "team" },
  { resource: "punch", action: "read", scope: "team" },
  { resource: "timecard", action: "read", scope: "team" },
] };
const lossPrevention = { isSystem: false, permissions: [
  { resource: "photo", action: "write", scope: "all" },
  { resource: "presence", action: "execute", scope: "all" },
] };
const employee = { isSystem: true, permissions: [{ resource: "punch", action: "write", scope: "own" }] };
const customPuncher = { isSystem: false, permissions: [{ resource: "punch", action: "write", scope: "own" }, { resource: "timecard", action: "read", scope: "team" }] };

describe("sign in only roles", () => {
  it("are custom roles that cannot punch for themselves", () => {
    expect(isSignInOnlyRole(agencyViewer)).toBe(true);
    expect(isSignInOnlyRole(lossPrevention)).toBe(true);
    expect(isSignInOnlyRole(employee)).toBe(false);
    expect(isSignInOnlyRole(customPuncher)).toBe(false);
    expect(isSignInOnlyRole({ isSystem: true, permissions: [] })).toBe(false);
  });

  it("a role with no permissions is a visitor's, not a sign in only login's", () => {
    const visitor = { isSystem: false, permissions: [] };
    expect(isVisitorRole(visitor)).toBe(true);
    expect(isSignInOnlyRole(visitor)).toBe(false);
    expect(isVisitorRole(agencyViewer)).toBe(false);
    expect(isVisitorRole(lossPrevention)).toBe(false);
    expect(isVisitorRole({ isSystem: true, permissions: [] })).toBe(false);
  });

  it("an agency viewer sees a team, Loss Prevention does not", () => {
    expect(seesTeam(agencyViewer)).toBe(true);
    expect(seesTeam(lossPrevention)).toBe(false);
  });
});
