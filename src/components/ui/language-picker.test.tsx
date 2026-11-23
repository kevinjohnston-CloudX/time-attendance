// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LanguagePicker } from "./language-picker";

function Harness({ start = "" }: { start?: string }) {
  const [v, setV] = useState(start);
  return (
    <form>
      <LanguagePicker aria-label="Language" name="lang" value={v} onChange={setV} />
    </form>
  );
}

const box = () => screen.getByRole("combobox", { name: "Language" }) as HTMLInputElement;
const optionNames = () => screen.queryAllByRole("option").map((o) => o.textContent?.replace("Selected", "").trim());

describe("LanguagePicker", () => {
  afterEach(cleanup);

  it("narrows the list as you type, names that start with it first", () => {
    render(<Harness />);
    fireEvent.focus(box());
    fireEvent.change(box(), { target: { value: "po" } });
    expect(optionNames()).toEqual(["Portuguese", "Polish"]);
    fireEvent.change(box(), { target: { value: "ish" } });
    expect(optionNames()).toEqual(expect.arrayContaining(["English", "Spanish", "Polish", "Turkish"]));
  });

  it("picks with the arrow keys and Enter, and sends the code", () => {
    render(<Harness />);
    fireEvent.focus(box());
    fireEvent.change(box(), { target: { value: "span" } });
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(box().value).toBe("Spanish");
    expect((document.querySelector('input[name="lang"]') as HTMLInputElement).value).toBe("es");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("puts back the language when what was typed matches nothing", () => {
    render(<Harness start="en" />);
    fireEvent.focus(box());
    fireEvent.change(box(), { target: { value: "zzz" } });
    expect(screen.getByText(/No language matches/)).toBeTruthy();
    fireEvent.blur(box());
    expect(box().value).toBe("English");
  });

  it("clears with the first choice", () => {
    render(<Harness start="en" />);
    fireEvent.focus(box());
    fireEvent.click(screen.getByRole("option", { name: "Not set" }));
    expect(box().value).toBe("");
    expect((document.querySelector('input[name="lang"]') as HTMLInputElement).value).toBe("");
  });

  it("draws the list at the end of the page, where a window's scroll cannot clip it", () => {
    const { container } = render(<Harness start="en" />);
    box().focus();
    fireEvent.focus(box());
    const list = screen.getByRole("listbox", { name: "Languages" });
    expect(container.contains(list)).toBe(false);
    expect(list.closest("[data-floating-layer]")?.parentElement).toBe(document.body);
    // A press on a name keeps the field focused and the list open until the click picks it.
    const spanish = screen.getByRole("option", { name: "Spanish" });
    expect(fireEvent.mouseDown(spanish)).toBe(false);
    expect(document.activeElement).toBe(box());
    expect(screen.getByRole("listbox")).toBeTruthy();
    // A new window size (a phone's keyboard opening) places it again under the field.
    list.style.top = "999px";
    fireEvent(window, new Event("resize"));
    expect(list.style.top).toBe("4px");
    fireEvent.click(spanish);
    expect(box().value).toBe("Spanish");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
