import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * CloudX WMS Button.
 *
 * <p>Ported from the design system bundle in the handoff, keeping its prop
 * names (hierarchy / size / tone) so a later export of that system still maps
 * onto this one without a translation layer.
 *
 * <p>The palette is passed down as CSS custom properties and the hover and
 * pressed states are CSS rules on .wms-btn in globals.css. That is how the
 * design system does it, and it is also the only way that works here: these
 * buttons set their background inline, and an inline style beats any
 * hover:bg-* utility.
 */

type Hierarchy = "primary" | "secondary" | "tertiary" | "link" | "linkSecondary";
type Tone = "regular" | "warning" | "error" | "success";
type Size = "sm" | "md";

const SIZES: Record<Size, { height: number; padX: number; gap: number; font: string }> = {
  sm: { height: 24, padX: 10, gap: 4, font: "var(--type-button2)" },
  md: { height: 32, padX: 12, gap: 4, font: "var(--type-button1)" },
};

/** Tone -> primary fill (default / hover / pressed). */
const PRIMARY_TONES: Record<Tone, [string, string, string]> = {
  regular: ["var(--fill-accent)", "var(--fill-accent-hover)", "var(--fill-accent-pressed)"],
  warning: ["var(--wms-color-amber-500)", "var(--wms-color-amber-600)", "var(--wms-color-amber-700)"],
  error: ["var(--wms-color-red-600)", "var(--wms-color-red-500)", "var(--wms-color-red-700)"],
  success: ["var(--wms-color-emerald-600)", "var(--wms-color-emerald-500)", "var(--wms-color-emerald-700)"],
};

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  children?: ReactNode;
  hierarchy?: Hierarchy;
  size?: Size;
  tone?: Tone;
  iconOnly?: boolean;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export function Button({
  children,
  hierarchy = "primary",
  size = "md",
  tone = "regular",
  iconOnly = false,
  fullWidth = false,
  leadingIcon,
  trailingIcon,
  type = "button",
  disabled = false,
  style,
  className = "",
  ...rest
}: ButtonProps) {
  const s = SIZES[size];
  const isLink = hierarchy === "link" || hierarchy === "linkSecondary";
  const isErr = tone === "error";

  let palette: Record<string, string>;
  if (isLink) {
    palette =
      hierarchy === "linkSecondary"
        ? { "--bg": "transparent", "--bg-h": "transparent", "--fg": "var(--link-primary)", "--fg-h": "var(--text-secondary)", "--bd": "transparent" }
        : isErr
          ? { "--bg": "transparent", "--bg-h": "transparent", "--fg": "var(--link-error)", "--fg-h": "var(--icon-error)", "--bd": "transparent" }
          : { "--bg": "transparent", "--bg-h": "transparent", "--fg": "var(--link-accent)", "--fg-h": "var(--link-accent-hover)", "--bd": "transparent" };
  } else if (hierarchy === "primary") {
    const [bg, bgH, bgA] = PRIMARY_TONES[tone];
    palette = {
      "--bg": bg,
      "--bg-h": bgH,
      "--bg-a": bgA,
      "--fg": "var(--text-on-accent)",
      "--fg-h": "var(--text-on-accent)",
      "--bd": "transparent",
    };
  } else if (hierarchy === "secondary") {
    palette = {
      "--bg": "var(--surface-card)",
      "--bg-h": "var(--fill-hover)",
      "--bg-a": "var(--fill-pressed)",
      "--fg": isErr ? "var(--text-error)" : "var(--text-primary)",
      "--fg-h": isErr ? "var(--text-error)" : "var(--text-primary)",
      "--bd": "var(--stroke-default)",
    };
  } else {
    palette = {
      "--bg": "transparent",
      "--bg-h": "var(--fill-hover)",
      "--bg-a": "var(--fill-pressed)",
      "--fg": isErr ? "var(--text-error)" : "var(--text-primary)",
      "--fg-h": isErr ? "var(--text-error)" : "var(--text-primary)",
      "--bd": "transparent",
    };
  }

  return (
    <button
      type={type}
      disabled={disabled}
      className={`wms-btn${isLink ? " wms-btn-link" : ""} ${className}`.trim()}
      style={{
        ...palette,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: s.gap,
        height: isLink ? 20 : s.height,
        padding: isLink ? 0 : iconOnly ? 0 : `0 ${s.padX}px`,
        width: fullWidth ? "100%" : iconOnly ? s.height : undefined,
        border: "1px solid var(--bd)",
        borderRadius: "var(--radius-m)",
        font: s.font,
        whiteSpace: "nowrap",
        cursor: disabled ? "not-allowed" : "pointer",
        boxShadow: hierarchy === "secondary" && !disabled ? "0px 1px 2px rgba(0,0,0,0.05)" : "none",
        ...style,
      } as React.CSSProperties}
      {...rest}
    >
      {leadingIcon}
      {children}
      {trailingIcon}
    </button>
  );
}
