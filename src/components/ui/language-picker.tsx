"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";
import { LANGUAGES, languageName } from "@/lib/languages";

/**
 * Pick a language by typing: the list narrows to the languages whose name
 * (or code) matches, names starting with what was typed first. Arrow keys
 * move, Enter picks, Escape puts back what was there. 35 languages were a
 * long scroll in a plain dropdown.
 *
 * <p>Controlled: `value` is a language code (lib/languages.ts) or "" for none.
 * Under `name` the code also goes in a hidden field, for forms that read
 * FormData. Typing something that matches nothing and leaving keeps the
 * language that was there.
 */
export function LanguagePicker({
  id,
  name,
  value,
  onChange,
  emptyLabel = "Not set",
  exclude = [],
  disabled = false,
  "aria-label": ariaLabel,
}: {
  id?: string;
  name?: string;
  value: string;
  onChange: (code: string) => void;
  emptyLabel?: string;
  /** Codes not to offer (a site's primary, among its other languages). */
  exclude?: string[];
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const listId = `lang-${useId().replace(/:/g, "")}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null); // null while not typing
  const [active, setActive] = useState(0);

  const options = useMemo(() => {
    const offered = LANGUAGES.filter((l) => !exclude.includes(l.code));
    const q = (text ?? "").trim().toLowerCase();
    if (!q) return [{ code: "", name: emptyLabel }, ...offered];
    const starts = offered.filter((l) => l.name.toLowerCase().startsWith(q) || l.code === q);
    const within = offered.filter((l) => !starts.includes(l) && l.name.toLowerCase().includes(q));
    return [...starts, ...within];
  }, [text, exclude, emptyLabel]);

  function pick(code: string) {
    onChange(code);
    setText(null);
    setOpen(false);
  }

  function close() {
    // Leaving with an exact name typed picks it; anything else puts back what was there.
    const typed = (text ?? "").trim().toLowerCase();
    const exact = typed ? LANGUAGES.find((l) => l.name.toLowerCase() === typed && !exclude.includes(l.code)) : undefined;
    if (exact) onChange(exact.code);
    setText(null);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
      setActive((i) => {
        const n = options.length;
        if (!n) return 0;
        return e.key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n;
      });
    } else if (e.key === "Enter") {
      // Never the form's submit while the list is open.
      if (open) {
        e.preventDefault();
        const o = options[active];
        if (o) pick(o.code);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setText(null);
        setOpen(false);
      }
    }
  }

  const shown = text ?? (value ? languageName(value) : "");

  return (
    <div className="relative w-full min-w-0">
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${listId}-${options[active].code || "none"}` : undefined}
        autoComplete="off"
        spellCheck={false}
        data-1p-ignore=""
        data-lpignore="true"
        disabled={disabled}
        value={shown}
        placeholder={emptyLabel}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={(e) => {
          e.target.select();
          setActive(0);
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onBlur={close}
        onKeyDown={onKeyDown}
        className="ta-field h-8 w-full rounded-md pl-2.5 pr-8"
        style={{
          border: "1px solid var(--stroke-default)",
          background: disabled ? "var(--surface-secondary)" : "var(--surface-card)",
          color: "var(--text-primary)",
          font: "var(--type-body1)",
        }}
      />
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2"
        style={{ color: "var(--icon-tertiary)" }}
      />
      {name && <input type="hidden" name={name} value={value} />}
      {open && !disabled && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Languages"
          className="ta-scroll absolute left-0 right-0 top-full z-50 m-0 mt-1 max-h-[260px] list-none overflow-y-auto rounded-lg p-1"
          style={{ background: "var(--surface-card)", boxShadow: "var(--ta-menu-shadow)" }}
        >
          {options.length === 0 ? (
            <li className="px-2.5 py-2" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
              No language matches &ldquo;{text}&rdquo;.
            </li>
          ) : (
            options.map((o, i) => (
              <li
                key={o.code || "none"}
                id={`${listId}-${o.code || "none"}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                // Picked before the input loses focus, which would close the list first.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o.code);
                }}
                className="flex cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5"
                style={{
                  font: "var(--type-body1)",
                  color: o.code ? "var(--text-primary)" : "var(--text-tertiary)",
                  background: i === active ? "var(--fill-hover)" : undefined,
                }}
              >
                <span>{o.name}</span>
                {o.code === value && value !== "" && (
                  <span style={{ font: "var(--type-caption1)", color: "var(--text-accent)" }}>Selected</span>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
