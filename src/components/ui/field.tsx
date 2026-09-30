"use client";

import { Search } from "lucide-react";
import { useId, type ChangeEvent, type ReactNode, type SelectHTMLAttributes } from "react";

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

/** Search box with a leading glyph, as the design draws it in list toolbars. */
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
    </label>
  );
}
