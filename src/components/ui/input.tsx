"use client";

import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

/**
 * CloudX WMS form controls.
 *
 * <p>Measurements taken from the design system bundle: a field is a bordered
 * box (not a bordered `input`) so the focus ring lands on the whole control
 * including any leading glyph, inner padding is 12 left / 8 right, and the
 * label, control and hint sit in a 6px stack.
 *
 * <p>`readOnly` is the design system's "Display" state — prepopulated, not
 * editable by this user, and visibly lighter than disabled. The distinction
 * matters on a timecard: a field an employee may not edit is not the same as
 * one that is switched off.
 */

const SIZES = {
  sm: { padding: "1px 8px 1px 12px", minHeight: 24 },
  md: { padding: "5px 8px 5px 12px", minHeight: 32 },
} as const;

type Size = keyof typeof SIZES;

function FieldShell({
  label,
  required,
  hint,
  error,
  children,
  htmlFor,
}: {
  label?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex w-full flex-col gap-1.5">
      {label && (
        <label htmlFor={htmlFor} style={{ font: "var(--type-button2)", color: "var(--text-secondary)" }}>
          {label}
          {required && (
            <span aria-hidden="true" style={{ color: "var(--text-error)", marginLeft: 3 }}>
              *
            </span>
          )}
        </label>
      )}
      {children}
      {(error || hint) && (
        <span style={{ font: "var(--type-caption1)", color: error ? "var(--text-error)" : "var(--text-tertiary)" }}>
          {error ?? hint}
        </span>
      )}
    </div>
  );
}

function shellStyle(size: Size, disabled: boolean, readOnly: boolean, error?: string) {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: SIZES[size].padding,
    minHeight: SIZES[size].minHeight,
    boxSizing: "border-box" as const,
    background: disabled ? "var(--fill-disabled)" : readOnly ? "var(--fill-readonly)" : "var(--surface-card)",
    borderWidth: 1,
    borderStyle: "solid" as const,
    borderRadius: "var(--radius-m)",
    color: disabled ? "var(--text-disabled)" : "var(--text-primary)",
    cursor: disabled ? "not-allowed" : readOnly ? "default" : "text",
    ["--ring" as string]: error ? "var(--wms-color-red-500)" : "var(--wms-color-primary-500)",
  };
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  hint?: string;
  error?: string;
  size?: Size;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export function Input({
  label,
  hint,
  error,
  size = "md",
  required = false,
  disabled = false,
  readOnly = false,
  leadingIcon,
  trailingIcon,
  id,
  style,
  ...rest
}: InputProps) {
  const fieldId = id ?? (label ? `f-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);

  return (
    <FieldShell label={label} required={required} hint={hint} error={error} htmlFor={fieldId}>
      <span
        className={`wms-input${readOnly ? " wms-input-ro" : ""}${error ? " wms-input-err" : ""}`}
        style={{ ...shellStyle(size, disabled, readOnly, error), ...style }}
      >
        {leadingIcon && (
          <span className="inline-flex h-4 w-4 flex-none" style={{ color: "var(--icon-tertiary)" }}>
            {leadingIcon}
          </span>
        )}
        <input
          id={fieldId}
          disabled={disabled}
          readOnly={readOnly}
          required={required}
          className="min-w-0 flex-1 border-0 bg-transparent outline-none"
          style={{ font: "var(--type-body1)", color: "inherit" }}
          {...rest}
        />
        {trailingIcon && (
          <span className="inline-flex h-4 w-4 flex-none" style={{ color: "var(--icon-tertiary)" }}>
            {trailingIcon}
          </span>
        )}
      </span>
    </FieldShell>
  );
}

export function Textarea({
  label,
  hint,
  error,
  required = false,
  disabled = false,
  readOnly = false,
  id,
  rows = 3,
  style,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; hint?: string; error?: string }) {
  const fieldId = id ?? (label ? `t-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);

  return (
    <FieldShell label={label} required={required} hint={hint} error={error} htmlFor={fieldId}>
      <span
        className={`wms-input${readOnly ? " wms-input-ro" : ""}${error ? " wms-input-err" : ""}`}
        style={{ ...shellStyle("md", disabled, readOnly, error), alignItems: "stretch", ...style }}
      >
        <textarea
          id={fieldId}
          rows={rows}
          disabled={disabled}
          readOnly={readOnly}
          required={required}
          className="min-w-0 flex-1 resize-y border-0 bg-transparent outline-none"
          style={{ font: "var(--type-body1)", color: "inherit" }}
          {...rest}
        />
      </span>
    </FieldShell>
  );
}

/**
 * The ring is an inset shadow rather than a border: a 1.5px CSS border rounds
 * to 1px at 1× DPR, which makes the unchecked box visibly thinner than the
 * design on ordinary monitors.
 */
export function Checkbox({
  checked = false,
  indeterminate = false,
  label,
  disabled = false,
  onChange,
  id,
}: {
  checked?: boolean;
  indeterminate?: boolean;
  label?: ReactNode;
  disabled?: boolean;
  onChange?: (next: boolean) => void;
  id?: string;
}) {
  const active = checked || indeterminate;
  const mark = disabled ? "var(--icon-disabled)" : "var(--fill-accent)";

  return (
    <label
      className="inline-flex items-center gap-2"
      style={{ cursor: disabled ? "not-allowed" : "pointer" }}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        className="wms-check sr-only"
      />
      <span
        aria-hidden="true"
        className="inline-flex flex-none items-center justify-center"
        style={{
          width: 20,
          height: 20,
          borderRadius: 6,
          boxSizing: "border-box",
          background: disabled ? "var(--fill-disabled)" : "var(--surface-card)",
          boxShadow:
            `inset 0 0 0 1.5px ${active && !disabled ? "var(--fill-accent)" : "var(--stroke-default)"}` +
            (disabled ? "" : ", 0px 1px 2px rgba(0,0,0,0.05)"),
          transition: "box-shadow .12s ease",
        }}
      >
        {indeterminate ? (
          <svg width="9" height="2" viewBox="0 0 9 2" fill="none">
            <path d="M1 1H8" stroke={mark} strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : checked ? (
          <svg width="11" height="8" viewBox="0 0 11 8" fill="none">
            <path d="M1 4L4 7L10 1" stroke={mark} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </span>
      {label && <span style={{ font: "var(--type-body1)", color: "var(--text-primary)" }}>{label}</span>}
    </label>
  );
}

export function Switch({
  checked = false,
  label,
  size = "md",
  disabled = false,
  onChange,
  id,
}: {
  checked?: boolean;
  label?: ReactNode;
  size?: "sm" | "md";
  disabled?: boolean;
  onChange?: (next: boolean) => void;
  id?: string;
}) {
  const d = size === "sm" ? { w: 32, h: 18, k: 14 } : { w: 38, h: 22, k: 18 };

  return (
    <label
      className="inline-flex items-center gap-2"
      style={{ cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1 }}
    >
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
        className="relative flex-none rounded-full border-0 p-0"
        style={{
          width: d.w,
          height: d.h,
          background: checked ? "var(--fill-accent)" : "var(--wms-color-gray-300)",
          cursor: "inherit",
          transition: "background-color .12s ease",
        }}
      >
        <span
          aria-hidden="true"
          className="absolute rounded-full"
          style={{
            width: d.k,
            height: d.k,
            top: (d.h - d.k) / 2,
            left: checked ? d.w - d.k - (d.h - d.k) / 2 : (d.h - d.k) / 2,
            background: "var(--wms-color-base-white)",
            boxShadow: "0px 1px 2px rgba(0,0,0,0.15)",
            transition: "left .12s ease",
          }}
        />
      </button>
      {label && <span style={{ font: "var(--type-body1)", color: "var(--text-primary)" }}>{label}</span>}
    </label>
  );
}
