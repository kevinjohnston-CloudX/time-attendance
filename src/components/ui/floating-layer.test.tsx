// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useRef, useState } from "react";
import { floatingPortal, pressedOutside, useOutsidePress, FLOATING_LAYER } from "./floating-layer";
import { Overlay } from "./overlay";
import { SelectLists } from "./select-lists";

afterEach(cleanup);
Element.prototype.scrollIntoView = vi.fn();

/** A panel that closes on a press outside it, with whatever is passed inside. */
function Panel({ children, onClose }: { children?: React.ReactNode; onClose?: () => void }) {
  const [open, setOpen] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  useOutsidePress({
    open,
    inside: [ref],
    onOutside: () => {
      setOpen(false);
      onClose?.();
    },
    escape: true,
  });
  return open ? (
    <div ref={ref} role="dialog" aria-label="Filters">
      {children}
    </div>
  ) : (
    <p>Panel closed</p>
  );
}

const panelOpen = () => screen.queryByRole("dialog", { name: "Filters" }) !== null;

describe("floatingPortal", () => {
  it("draws at the end of the page, marked, without a box of its own", () => {
    render(<div data-testid="host">{floatingPortal(<span>Layer</span>)}</div>);
    const layer = screen.getByText("Layer").parentElement!;
    expect(layer.hasAttribute(FLOATING_LAYER)).toBe(true);
    expect(layer.style.display).toBe("contents");
    expect(layer.parentElement).toBe(document.body);
    expect(screen.getByTestId("host").contains(layer)).toBe(false);
  });
});

describe("a panel that closes on a press outside it (ticket 79224)", () => {
  it("closes on a press truly outside, and on Escape", () => {
    render(
      <>
        <Panel />
        <button type="button">Elsewhere</button>
      </>,
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }));
    expect(panelOpen()).toBe(false);
    cleanup();
    render(<Panel />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(panelOpen()).toBe(false);
  });

  it("stays open on a press inside it", () => {
    render(
      <Panel>
        <button type="button">Inside</button>
      </Panel>,
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "Inside" }));
    expect(panelOpen()).toBe(true);
  });

  it("stays open on a press on a layer it drew at the end of the page: a list, a window", () => {
    render(
      <Panel>
        {floatingPortal(<button type="button">An option in a list</button>)}
        <Overlay>
          <button type="button">A button in a window</button>
        </Overlay>
      </Panel>,
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "An option in a list" }));
    expect(panelOpen()).toBe(true);
    fireEvent.pointerDown(screen.getByRole("button", { name: "A button in a window" }));
    expect(panelOpen()).toBe(true);
  });

  it("picks a dropdown option inside it and stays open", () => {
    const onChange = vi.fn();
    render(
      <>
        <SelectLists />
        <Panel>
          <select aria-label="Exceptions" defaultValue="any" onChange={(e) => onChange(e.target.value)}>
            <option value="any">Any or none</option>
            <option value="missed">Missed punch</option>
          </select>
        </Panel>
      </>,
    );
    const sel = screen.getByRole("combobox", { name: "Exceptions" });
    fireEvent.pointerDown(sel, { pointerType: "mouse" });
    fireEvent.mouseDown(sel, { button: 0 });
    const option = within(screen.getByRole("listbox", { name: "Exceptions" })).getByRole("option", { name: "Missed punch" });
    fireEvent.pointerDown(option, { pointerType: "mouse" });
    fireEvent.mouseDown(option, { button: 0 });
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith("missed");
    expect(panelOpen()).toBe(true);
  });

  it("closes on a press elsewhere in the window it sits in", () => {
    render(
      <Overlay>
        <button type="button">Window background</button>
        <Panel />
      </Overlay>,
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "Window background" }));
    expect(panelOpen()).toBe(false);
  });
});

describe("pressedOutside", () => {
  it("counts nothing for a press on something no longer on the page", () => {
    const panel = document.createElement("div");
    document.body.append(panel);
    const gone = document.createElement("span");
    expect(pressedOutside(gone, [panel])).toBe(false);
    panel.remove();
  });
});
