// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PasswordInput } from "./password-input";

function SignIn({ onSubmit }: { onSubmit?: (typeAtSubmit: string) => void }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.((document.getElementById("password") as HTMLInputElement).type);
      }}
    >
      <PasswordInput id="password" name="password" autoComplete="current-password" defaultValue="Secret12" />
      <button type="submit">Sign In</button>
    </form>
  );
}

const box = () => document.getElementById("password") as HTMLInputElement;

describe("the password field's eye (Juan, 11/23)", () => {
  afterEach(cleanup);

  it("starts hidden, with a Show password button tied to the field", () => {
    render(<SignIn />);
    expect(box().type).toBe("password");
    const eye = screen.getByRole("button", { name: "Show password" });
    expect(eye.getAttribute("type")).toBe("button");
    expect(eye.getAttribute("aria-controls")).toBe("password");
  });

  it("shows and hides what was typed, and says so to a screen reader", () => {
    render(<SignIn />);
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(box().type).toBe("text");
    expect(box().value).toBe("Secret12");
    expect(screen.getByText("Password shown")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(box().type).toBe("password");
    expect(screen.getByText("Password hidden")).toBeTruthy();
  });

  it("never lets spell check or a phone's capitals near the password", () => {
    render(<SignIn />);
    expect(box().getAttribute("spellcheck")).toBe("false");
    expect(box().getAttribute("autocapitalize")).toBe("none");
    expect(box().getAttribute("autocomplete")).toBe("current-password");
  });

  it("hides it again before the form is sent", () => {
    let typeAtSubmit = "";
    render(<SignIn onSubmit={(t) => (typeAtSubmit = t)} />);
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(box().type).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
    expect(typeAtSubmit).toBe("password");
    expect(box().type).toBe("password");
    expect(screen.getByRole("button", { name: "Show password" })).toBeTruthy();
  });

  it("hides it again when the page comes back from the Back button", () => {
    render(<SignIn />);
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    act(() => {
      const back = new Event("pageshow") as PageTransitionEvent;
      Object.defineProperty(back, "persisted", { value: true });
      window.dispatchEvent(back);
    });
    expect(box().type).toBe("password");
  });

  it("keeps the cursor in the field, where it was, so typing carries on", () => {
    render(<SignIn />);
    box().focus();
    box().setSelectionRange(3, 3);
    const eye = screen.getByRole("button", { name: "Show password" });
    const kept = fireEvent.mouseDown(eye);
    fireEvent.click(eye);
    expect(kept).toBe(false); // the press did not take the focus away
    expect(document.activeElement).toBe(box());
    expect(box().selectionStart).toBe(3);
  });

  it("is switched off with the field", () => {
    render(<PasswordInput id="pw" disabled />);
    expect((screen.getByRole("button", { name: "Show password" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
