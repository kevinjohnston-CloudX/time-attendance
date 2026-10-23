// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/actions/punch.actions", () => ({ recordPunch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { PunchHero } from "./punch-hero";

afterEach(cleanup);

describe("the Punch Clock's punch card", () => {
  it("has no punch buttons for someone at the time clock only, and says where they punch", () => {
    render(<PunchHero state="OUT" context="" stats={[]} canPunch={false} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("You punch at the time clock.")).not.toBeNull();
  });

  it("has the punch buttons for someone allowed to punch from the web", () => {
    render(<PunchHero state="OUT" context="" stats={[]} canPunch />);
    expect(screen.getByRole("button", { name: "Clock In" })).not.toBeNull();
  });
});
