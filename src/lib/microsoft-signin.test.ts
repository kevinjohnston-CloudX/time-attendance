import { describe, expect, it } from "vitest";
import { microsoftAddresses, microsoftIssuer, microsoftSignInOffered, signInRefused } from "./microsoft-signin";

/**
 * Who a Microsoft account may sign in as: the verified sign in name, and an
 * email claim only on the same domain. Anything else is refused, never
 * matched (the "nOAuth" guard).
 */

describe("microsoftAddresses", () => {
  it("uses the verified sign in name, lowercased", () => {
    expect(microsoftAddresses({ preferred_username: "Ana.Lopez@Hotmail.com" })).toEqual(["ana.lopez@hotmail.com"]);
  });
  it("adds an email claim on the same domain, after the sign in name", () => {
    expect(microsoftAddresses({ preferred_username: "alopez@bergen.com", email: "Ana.Lopez@bergen.com" })).toEqual([
      "alopez@bergen.com",
      "ana.lopez@bergen.com",
    ]);
    expect(microsoftAddresses({ preferred_username: "ana@outlook.com", email: "ana@outlook.com" })).toEqual(["ana@outlook.com"]);
  });
  it("refuses an email claim on another domain: another directory posing as one of our people", () => {
    expect(microsoftAddresses({ preferred_username: "attacker@evil.onmicrosoft.com", email: "juan.munoz@cloudxsystems.net" })).toBeNull();
  });
  it("refuses without a usable sign in name", () => {
    expect(microsoftAddresses({ email: "ana@bergenlogistics.com" })).toBeNull();
    expect(microsoftAddresses({ preferred_username: "not-an-address" })).toBeNull();
    expect(microsoftAddresses(null)).toBeNull();
  });
});

describe("settings", () => {
  it("offers Microsoft only once both keys are set", () => {
    expect(microsoftSignInOffered({} as NodeJS.ProcessEnv)).toBe(false);
    expect(microsoftSignInOffered({ AZURE_AD_CLIENT_ID: "id" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(microsoftSignInOffered({ AZURE_AD_CLIENT_ID: "id", AZURE_AD_CLIENT_SECRET: "s" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
  it("takes work and personal accounts unless narrowed", () => {
    expect(microsoftIssuer({} as NodeJS.ProcessEnv)).toBe("https://login.microsoftonline.com/common/v2.0");
    expect(microsoftIssuer({ AZURE_AD_TENANT_ID: "organizations" } as unknown as NodeJS.ProcessEnv)).toBe(
      "https://login.microsoftonline.com/organizations/v2.0",
    );
  });
  it("sends a refusal back to the sign in page with the reason and the provider", () => {
    expect(signInRefused("NotSetUp", "microsoft")).toBe("/login?error=NotSetUp&with=microsoft");
  });
});
