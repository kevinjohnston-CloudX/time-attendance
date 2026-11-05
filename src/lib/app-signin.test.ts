import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appChallengeFor, issueAppSigninCode, redeemAppSigninCode } from "./app-signin";

const verifier = "v".repeat(43);
const challenge = appChallengeFor(verifier);

describe("signing in to the phone app through the browser", () => {
  const saved = process.env.APP_SIGNIN_SECRET;
  beforeEach(() => {
    process.env.APP_SIGNIN_SECRET = "k".repeat(32);
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.APP_SIGNIN_SECRET;
    else process.env.APP_SIGNIN_SECRET = saved;
  });

  it("gives the app back the person the code was issued to", () => {
    const code = issueAppSigninCode("user_1", challenge)!;
    expect(redeemAppSigninCode(code, verifier)).toBe("user_1");
  });

  it("refuses the code with any other verifier, so a caught link is useless", () => {
    const code = issueAppSigninCode("user_1", challenge)!;
    expect(redeemAppSigninCode(code, "w".repeat(43))).toBeNull();
  });

  it("refuses a code after two minutes", () => {
    const code = issueAppSigninCode("user_1", challenge, 0)!;
    expect(redeemAppSigninCode(code, verifier, 2 * 60 * 1000 + 1)).toBeNull();
  });

  it("refuses a code whose person was swapped", () => {
    const [, signature] = issueAppSigninCode("user_1", challenge)!.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "user_2", c: challenge, e: Date.now() + 60_000 })).toString("base64url");
    expect(redeemAppSigninCode(`${forged}.${signature}`, verifier)).toBeNull();
  });

  it("refuses a code signed with another secret", () => {
    const code = issueAppSigninCode("user_1", challenge)!;
    process.env.APP_SIGNIN_SECRET = "z".repeat(32);
    expect(redeemAppSigninCode(code, verifier)).toBeNull();
  });

  it("issues and accepts nothing when the secret is unset or short", () => {
    const code = issueAppSigninCode("user_1", challenge)!;
    delete process.env.APP_SIGNIN_SECRET;
    expect(issueAppSigninCode("user_1", challenge)).toBeNull();
    expect(redeemAppSigninCode(code, verifier)).toBeNull();
    process.env.APP_SIGNIN_SECRET = "short";
    expect(issueAppSigninCode("user_1", challenge)).toBeNull();
  });

  it("refuses a challenge that is not a SHA-256 hash and junk codes", () => {
    expect(issueAppSigninCode("user_1", "not-a-hash")).toBeNull();
    expect(redeemAppSigninCode("junk", verifier)).toBeNull();
    expect(redeemAppSigninCode("a.b.c", verifier)).toBeNull();
    expect(redeemAppSigninCode(undefined, verifier)).toBeNull();
  });
});
