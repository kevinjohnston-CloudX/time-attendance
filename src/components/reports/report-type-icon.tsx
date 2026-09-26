import { createElement } from "react";
import { dataSourceIcon, dataSourceTone } from "./data-source-label";

/**
 * A report type's glyph in its own tinted square, the one mark that tells
 * the types apart at a glance on the list, the picker and the empty state.
 */
export function ReportTypeIcon({ id, size = 36 }: { id: string; size?: number }) {
  const tone = dataSourceTone(id);
  const glyph = Math.round(size * 0.5);
  return (
    <span
      className="flex flex-none items-center justify-center"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), background: tone.bg, color: tone.fg }}
      aria-hidden="true"
    >
      {createElement(dataSourceIcon(id), { style: { width: glyph, height: glyph } })}
    </span>
  );
}
