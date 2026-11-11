// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { SelectLists } from "./select-lists";

/**
 * Every dropdown's list on a computer: the select stays a real select, our
 * list opens instead of the browser's, and a pick reaches the caller's
 * onChange exactly as a native pick does.
 */
afterEach(cleanup);
// jsdom draws nothing, so it has no scrolling to bring an option into view.
Element.prototype.scrollIntoView = vi.fn();

function Field({ onPick }: { onPick: (v: string) => void }) {
  const [v, setV] = useState("b");
  return (
    <select
      aria-label="Shift"
      value={v}
      onChange={(e) => {
        setV(e.target.value);
        onPick(e.target.value);
      }}
    >
      <option value="a">Days</option>
      <option value="b">Nights</option>
      <optgroup label="Weekend">
        <option value="c">Saturday</option>
        <option value="d" disabled>
          Sunday
        </option>
      </optgroup>
    </select>
  );
}

describe("SelectLists", () => {
  it("opens our list on a click, the chosen one checked, and a pick runs onChange", () => {
    const onPick = vi.fn();
    render(
      <>
        <SelectLists />
        <Field onPick={onPick} />
      </>,
    );
    const sel = screen.getByRole("combobox", { name: "Shift" }) as HTMLSelectElement;
    fireEvent.pointerDown(sel, { pointerType: "mouse" });
    fireEvent.mouseDown(sel, { button: 0 });
    const list = screen.getByRole("listbox", { name: "Shift" });
    expect(sel.getAttribute("aria-expanded")).toBe("true");
    expect(list.textContent).toContain("Weekend");
    expect(within(list).getByRole("option", { name: "Nights" }).getAttribute("data-chosen")).not.toBeNull();
    fireEvent.click(within(list).getByRole("option", { name: "Saturday" }));
    expect(onPick).toHaveBeenCalledWith("c");
    expect(sel.value).toBe("c");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("works from the keys, skips a disabled option, and Escape closes without a pick", () => {
    const onPick = vi.fn();
    render(
      <>
        <SelectLists />
        <Field onPick={onPick} />
      </>,
    );
    const sel = screen.getByRole("combobox", { name: "Shift" });
    sel.focus();
    fireEvent.keyDown(sel, { key: "ArrowDown" });
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(sel, { key: "ArrowDown" });
    fireEvent.keyDown(sel, { key: "ArrowDown" });
    expect(within(list).getByRole("option", { name: "Saturday" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(sel, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.keyDown(sel, { key: "Enter" });
    fireEvent.keyDown(sel, { key: "d" });
    fireEvent.keyDown(sel, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("a");
  });

  it("leaves a select marked native alone", () => {
    render(
      <>
        <SelectLists />
        <div data-native-select="">
          <select aria-label="Plain">
            <option>One</option>
          </select>
        </div>
      </>,
    );
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Plain" }), { button: 0 });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
