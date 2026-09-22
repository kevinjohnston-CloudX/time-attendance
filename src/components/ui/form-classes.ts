/**
 * Shared class strings for the configuration editors.
 *
 * <p><b>Why strings and not components.</b> Four editors — rule sets, PTO
 * policies, shifts and leave balances — are large forms that each declared
 * their own near-identical `inputCls` / `saveBtnCls` / `cancelBtnCls`
 * constants and then used them a few hundred times. Swapping those call sites
 * for <Input> components would mean editing several hundred lines across the
 * screens that compute overtime and meal deductions. Changing the four
 * definitions to point here restyles all of them and touches no handler.
 *
 * <p><b>What actually changed.</b> Two things the copies had in common:
 *
 * <p>1. The primary button was `bg-zinc-900` with `dark:bg-zinc-100` — black
 * in light mode, white in dark. The design system is explicit that Primary
 * Blue 600 is the single action colour, so "Save" in every one of these
 * editors was the one button in the product not using it.
 *
 * <p>2. Focus was `focus:border-zinc-500`, a slightly darker border. The
 * design system's focus state is a soft blue glow, which is what tells you
 * where the caret is on a form with forty fields on it.
 */

/** 32px control, the design system's md field. */
export const fieldCls =
  "w-full rounded-md border border-[var(--stroke-secondary)] bg-[var(--surface-card)] px-3 py-1.5 text-sm text-[var(--text-primary)] outline-none transition-[border-color,box-shadow] duration-100 hover:border-[var(--stroke-hover)] focus:border-[var(--stroke-accent)] focus:shadow-[var(--focus-ring-tight)]";

/** 24px control, for cells inside a grid where a full field would not fit. */
export const smFieldCls =
  "w-full rounded border border-[var(--stroke-secondary)] bg-[var(--surface-card)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none transition-[border-color,box-shadow] duration-100 hover:border-[var(--stroke-hover)] focus:border-[var(--stroke-accent)] focus:shadow-[var(--focus-ring-tight)]";

export const labelCls = "mb-1 block text-xs text-[var(--text-secondary)]";

export const smLabelCls =
  "mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]";

/** The single action colour. */
export const primaryBtnCls =
  "rounded-md bg-[var(--fill-accent)] px-3 py-1.5 text-sm font-medium text-[var(--text-on-accent)] transition-colors duration-100 hover:bg-[var(--fill-accent-hover)] active:bg-[var(--fill-accent-pressed)] disabled:cursor-not-allowed disabled:bg-[var(--fill-disabled)] disabled:text-[var(--text-disabled)]";

export const secondaryBtnCls =
  "rounded-md border border-[var(--stroke-default)] bg-[var(--surface-card)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)] transition-colors duration-100 hover:bg-[var(--fill-hover)] disabled:cursor-not-allowed disabled:opacity-50";

export const dangerBtnCls =
  "rounded-md bg-[var(--wms-color-red-600)] px-3 py-1.5 text-sm font-medium text-white transition-colors duration-100 hover:bg-[var(--wms-color-red-500)] active:bg-[var(--wms-color-red-700)] disabled:cursor-not-allowed disabled:bg-[var(--fill-disabled)] disabled:text-[var(--text-disabled)]";

export const sectionHdrCls =
  "col-span-full mb-0.5 border-b border-[var(--stroke-divider)] pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]";
