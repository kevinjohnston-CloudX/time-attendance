"use client";

import { Search, X } from "lucide-react";
import { useId, useRef, type ChangeEvent, type ReactNode, type SelectHTMLAttributes } from "react";

/**
 * The two controls a list toolbar is made of, from the portal design.
 *
 * <p>Both were previously written out per screen as a shared `selectClass`
 * string or a one-off className, which is why the audit log and the employee
 * list had differently-sized dropdowns doing the same job.
 */

/** 32px, hairline, focus ring from the design system. */
export function Select({
  children,
  style,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select
      {...rest}
      className="ta-field h-8 rounded-md px-2.5"
      style={{
        border: "1px solid var(--stroke-default)",
        background: "var(--surface-card)",
        color: "var(--text-primary)",
        font: "var(--type-body1)",
        cursor: "pointer",
        ...style,
      }}
    >
      {children}
    </select>
  );
}

/**
 * Search box with a leading glyph, as the design draws it in list toolbars.
 * Once something is typed an ✕ clears it, and the list with it: the
 * browser's own clear button is hidden (globals.css), so the text had to be
 * deleted by hand (Tony, 11/19).
 */
export function SearchInput({
  value,
  onValueChange,
  placeholder,
  width = 260,
}: {
  value: string;
  onValueChange: (v: string) => void;
  placeholder?: string;
  width?: number;
}) {
  const searchId = `search-${useId().replace(/:/g, "")}`;
  const input = useRef<HTMLInputElement>(null);
  return (
    <label
      className="ta-field ta-search flex h-8 items-center gap-2 rounded-md px-2.5"
      style={{
        border: "1px solid var(--stroke-default)",
        background: "var(--surface-card)",
        flex: `0 1 ${width}px`,
        minWidth: 160,
      }}
    >
      <Search className="h-4 w-4 flex-none" style={{ color: "var(--icon-tertiary)" }} />
      {/* A search box, said every way browsers and password managers look
          for it, so none of them offers to save or fill a login here. The
          name says "search" too: Safari and the iCloud Passwords extension
          read a field's name, and "q" told them nothing. */}
      <input
        ref={input}
        type="search"
        name="search"
        id={searchId}
        role="searchbox"
        enterKeyHint="search"
        aria-label={placeholder ?? "Search"}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-1p-ignore=""
        data-lpignore="true"
        data-bwignore="true"
        data-form-type="other"
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onValueChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 border-0 bg-transparent outline-none"
        style={{ font: "var(--type-body1)", color: "var(--text-primary)" }}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          title="Clear search"
          onClick={(e) => {
            // Not the label's click, which would only move focus.
            e.preventDefault();
            onValueChange("");
            input.current?.focus();
          }}
          className="ta-hoverable flex h-5 w-5 flex-none items-center justify-center rounded"
          style={{ border: 0, padding: 0, background: "transparent", color: "var(--icon-tertiary)", cursor: "pointer" }}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </label>
  );
}
