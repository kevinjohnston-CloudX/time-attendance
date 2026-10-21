import { afterEach, describe, expect, it } from "vitest";
import { cronAuthorized } from "./cron-auth";

const call = (authorization?: string) =>
  new Request("https://example.test/api/cron/daily-accruals", { headers: authorization ? { authorization } : {} });

describe("a scheduled job's secret", () => {
  const saved = process.env.CRON_SECRET;
  afterEach(() => {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  });

  it("lets Vercel's call through", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(cronAuthorized(call("Bearer s3cret"))).toBe(true);
  });

  it("refuses a wrong or missing header", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(cronAuthorized(call("Bearer nope"))).toBe(false);
    expect(cronAuthorized(call())).toBe(false);
  });

  it("refuses everything when the secret is not set, \"Bearer undefined\" included", () => {
    delete process.env.CRON_SECRET;
    expect(cronAuthorized(call("Bearer undefined"))).toBe(false);
    expect(cronAuthorized(call("Bearer "))).toBe(false);
  });
});
