// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSearchBox } from "./use-search-box";

afterEach(() => vi.useRealTimers());

function box() {
  vi.useFakeTimers();
  const search = vi.fn();
  const hook = renderHook(({ urlQ }) => useSearchBox(urlQ, search), { initialProps: { urlQ: "" } });
  const type = (v: string) => {
    act(() => hook.result.current.onChange(v));
    act(() => vi.advanceTimersByTime(350));
  };
  const arrive = (urlQ: string) => hook.rerender({ urlQ });
  return { hook, search, type, arrive };
}

describe("a list's search box, typed slowly", () => {
  it("keeps every character while earlier results arrive (1, 2, 3 searched as 13 on the Employees list)", () => {
    const { hook, search, type, arrive } = box();
    type("1");
    type("12");
    arrive("1"); // the results for 1 land after the 2 was typed
    expect(hook.result.current.value).toBe("12");
    type("123");
    arrive("12");
    expect(hook.result.current.value).toBe("123");
    arrive("123");
    expect(hook.result.current.value).toBe("123");
    expect(search.mock.calls.map((c) => c[0])).toEqual(["1", "12", "123"]);
  });

  it("asks once more for the latest search when an older one's results land last", () => {
    const { hook, search, type, arrive } = box();
    type("1");
    type("12");
    arrive("12");
    arrive("1"); // out of order
    expect(hook.result.current.value).toBe("12");
    expect(search.mock.calls.map((c) => c[0])).toEqual(["1", "12", "12"]);
    arrive("1");
    expect(search).toHaveBeenCalledTimes(3);
  });

  it("follows the address when the change did not come from typing (Back, Clear all, a link)", () => {
    const { hook, type, arrive } = box();
    type("12");
    arrive("12");
    arrive("smith");
    expect(hook.result.current.value).toBe("smith");
  });

  it("keeps a trailing space on a screen that trims the search it sends (the Audit Log)", () => {
    vi.useFakeTimers();
    const search = vi.fn();
    const hook = renderHook(({ urlQ }) => useSearchBox(urlQ, search, { normalize: (q) => q.trim() }), { initialProps: { urlQ: "" } });
    act(() => hook.result.current.onChange("john "));
    act(() => vi.advanceTimersByTime(350));
    hook.rerender({ urlQ: "john" });
    expect(hook.result.current.value).toBe("john ");
  });

  it("sends nothing typed before a reset", () => {
    const { hook, search } = box();
    act(() => hook.result.current.onChange("abc"));
    act(() => hook.result.current.reset(""));
    act(() => vi.advanceTimersByTime(1000));
    expect(search).not.toHaveBeenCalled();
    expect(hook.result.current.value).toBe("");
  });
});
