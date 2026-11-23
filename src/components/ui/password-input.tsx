"use client";

import { Eye, EyeOff } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Input, type InputProps } from "./input";
import styles from "./password-input.module.css";

const noSubscription = () => () => {};
/** The field the eye belongs to: it sits inside the field's box, beside it. */
const inputOf = (button: HTMLButtonElement | null) => button?.parentElement?.querySelector("input") ?? null;

/**
 * A password field with an eye at its end that shows what was typed, and
 * hides it again (Juan, 2026-11-23). Built the way the GOV.UK Design System's
 * password input is, which OWASP's ASVS (V6.2.6) and NIST SP 800-63B allow:
 *
 * <p>Hidden by default, every time the page opens, since people sign in where
 * others can see the screen. The button is a plain button (never a submit),
 * named "Show password" or "Hide password" for what it will do, tied to the
 * field (aria-controls), and a screen reader is told "Password shown" or
 * "Password hidden" after each press. It only appears once the page's code
 * has loaded, so it is never a button that does nothing.
 *
 * <p>Hidden again the moment the form is sent, before anything else reads it,
 * so a browser saves the password as a password and never as a remembered
 * entry for a plain text box; and when the page comes back from the browser's
 * Back button with what was typed still in it.
 *
 * <p>Spelling and capital letters are switched off, so a browser's spell
 * check (some send the text to an online service) never reads a shown
 * password, and a phone does not capitalise its first letter. Pressing the
 * eye keeps the cursor where it was in the field, so typing carries on.
 */
export function PasswordInput({
  label = "Password",
  id,
  className,
  disabled,
  ...rest
}: Omit<InputProps, "type" | "trailingAction" | "trailingIcon">) {
  const autoId = `password-${useId().replace(/:/g, "")}`;
  const fieldId = id ?? autoId;
  const [shown, setShown] = useState(false);
  const [said, setSaid] = useState("");
  const button = useRef<HTMLButtonElement>(null);
  // The caret to put back after the field changes from hidden to shown.
  const caret = useRef<{ start: number | null; end: number | null } | null>(null);
  const ready = useSyncExternalStore(noSubscription, () => true, () => false);

  useEffect(() => {
    const input = inputOf(button.current);
    if (!input) return;
    const hide = () => {
      // Straight on the element too: the submit is read before React draws again.
      input.type = "password";
      setShown(false);
    };
    const form = input.form;
    form?.addEventListener("submit", hide, true);
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) hide();
    };
    window.addEventListener("pageshow", onShow);
    return () => {
      form?.removeEventListener("submit", hide, true);
      window.removeEventListener("pageshow", onShow);
    };
  }, [ready]);

  useLayoutEffect(() => {
    const input = inputOf(button.current);
    const at = caret.current;
    caret.current = null;
    if (!input || !at) return;
    input.focus();
    if (at.start !== null && at.end !== null) input.setSelectionRange(at.start, at.end);
  }, [shown]);

  const name = label.toLowerCase();
  const toggle = () => {
    const input = inputOf(button.current);
    if (input && document.activeElement === input) caret.current = { start: input.selectionStart, end: input.selectionEnd };
    setShown(!shown);
    setSaid(`${label} ${shown ? "hidden" : "shown"}`);
  };

  return (
    <Input
      {...rest}
      id={fieldId}
      label={label}
      disabled={disabled}
      type={shown ? "text" : "password"}
      className={`${styles.input}${className ? ` ${className}` : ""}`}
      spellCheck={false}
      autoCapitalize="none"
      autoCorrect="off"
      trailingAction={
        ready && (
          <>
            <button
              ref={button}
              type="button"
              className={`ta-hoverable ${styles.toggle}`}
              aria-controls={fieldId}
              aria-label={shown ? `Hide ${name}` : `Show ${name}`}
              title={shown ? `Hide ${name}` : `Show ${name}`}
              disabled={disabled}
              // A click with the cursor in the field leaves it there, so the
              // keyboard on a phone stays open and typing carries on.
              onMouseDown={(e) => {
                if (document.activeElement === inputOf(button.current)) e.preventDefault();
              }}
              onClick={toggle}
            >
              {shown ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </button>
            <span className="sr-only" aria-live="polite">
              {said}
            </span>
          </>
        )
      }
    />
  );
}
