// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { useOnPulseChange } from "./use-site-pulse";

/** A pulse value as the page sees it, moved on by hand. */
function setup(minGapMs?: number) {
  const onChange = vi.fn();
  const hook = renderHook(
    ({ value, enabled }: { value: string | null | undefined; enabled: boolean }) =>
      useOnPulseChange(value, enabled, onChange, minGapMs),
    { initialProps: { value: "a" as string | null | undefined, enabled: true } },
  );
  return { onChange, set: (value: string, enabled = true) => hook.rerender({ value, enabled }), hook };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useOnPulseChange", () => {
  it("takes the first value as the baseline and runs on each change, with no gap", () => {
    const { onChange, set } = setup();
    expect(onChange).not.toHaveBeenCalled();
    set("b");
    set("c");
    expect(onChange).toHaveBeenCalledTimes(2);
    set("c");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("runs the first change at once, then holds changes inside the gap and runs them once at its end", () => {
    const { onChange, set } = setup(5_000);
    set("b");
    expect(onChange).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    set("c");
    vi.advanceTimersByTime(1_000);
    set("d");
    expect(onChange).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_999);
    expect(onChange).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(10_000);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("runs at once again when a change comes after the gap", () => {
    const { onChange, set } = setup(5_000);
    set("b");
    vi.advanceTimersByTime(6_000);
    set("c");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("drops a held run when the view is turned off, and starts from a new baseline", () => {
    const { onChange, set } = setup(5_000);
    set("b");
    set("c");
    set("c", false);
    vi.advanceTimersByTime(10_000);
    expect(onChange).toHaveBeenCalledTimes(1);
    set("d");
    expect(onChange).toHaveBeenCalledTimes(1);
    set("e");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("drops a held run when the page closes", () => {
    const { onChange, set, hook } = setup(5_000);
    set("b");
    set("c");
    hook.unmount();
    vi.advanceTimersByTime(10_000);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
