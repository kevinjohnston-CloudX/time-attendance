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
    fireEvent.mouseDown(screen.getByRole("option", { name: "Not set" }));
    expect(box().value).toBe("");
    expect((document.querySelector('input[name="lang"]') as HTMLInputElement).value).toBe("");
  });
});
