// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { DateCalendars } from "./date-calendars";

/**
 * Every date field's calendar on a computer: the field stays a real date
 * field, our calendar opens on a click, a picked day reaches the caller's
 * onChange as typing would, and days outside min and max cannot be picked.
 */
afterEach(cleanup);

function Field({ onPick, required = false }: { onPick: (v: string) => void; required?: boolean }) {
  const [v, setV] = useState("2026-11-11");
  return (
    <input
      type="date"
      aria-label="Work date"
      min="2026-11-08"
      max="2026-11-21"
      required={required}
      value={v}
      onChange={(e) => {
        setV(e.target.value);
        onPick(e.target.value);
      }}
    />
  );
}

function openOn(el: HTMLElement) {
  fireEvent.pointerDown(el, { pointerType: "mouse" });
  fireEvent.click(el);
  return screen.getByRole("dialog", { name: "Work date, calendar" });
}

describe("DateCalendars", () => {
  it("opens on the field's month, and a picked day runs onChange", () => {
    const onPick = vi.fn();
    render(
      <>
        <DateCalendars />
        <Field onPick={onPick} />
      </>,
    );
    const cal = openOn(screen.getByLabelText("Work date"));
    expect(cal.textContent).toContain("November 2026");
    expect(within(cal).getByRole("gridcell", { name: /November 11, 2026/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(within(cal).getByRole("gridcell", { name: /November 14, 2026/ }));
    expect(onPick).toHaveBeenCalledWith("2026-11-14");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("holds back days outside min and max, and Clear only when the date may be empty", () => {
    render(
      <>
        <DateCalendars />
        <Field onPick={() => {}} required />
      </>,
    );
    const cal = openOn(screen.getByLabelText("Work date"));
    expect((within(cal).getByRole("gridcell", { name: /November 7, 2026/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(cal).getByRole("gridcell", { name: /November 22, 2026/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(cal).queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("moves by the keys after Alt and the down arrow, and Escape closes without a pick", () => {
    const onPick = vi.fn();
    render(
      <>
        <DateCalendars />
        <Field onPick={onPick} />
      </>,
    );
    const field = screen.getByLabelText("Work date");
    field.focus();
    fireEvent.keyDown(field, { key: "ArrowDown", altKey: true });
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: "ArrowDown", altKey: true });
    fireEvent.keyDown(field, { key: "ArrowDown" });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("2026-11-18");
  });
});
