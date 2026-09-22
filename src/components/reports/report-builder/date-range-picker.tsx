"use client";

import { Input, SegmentedControl, Select } from "@/components/ui";
import type { DateRange } from "@/lib/validators/report.schema";

/**
 * The window a report runs over.
 *
 * <p>Three kinds, and the kind is a SegmentedControl rather than a row of
 * buttons: it is one choice out of three, which is exactly what that control
 * is for, and it was previously three pills that each set a different shape of
 * value with nothing saying they were alternatives.
 *
 * <p>A local SegmentedControl and not SegmentedLinks — the range belongs to
 * the builder's unsaved state, not to the URL. Nothing about this screen can
 * be reloaded into place.
 */

const RANGE_KINDS = [
  { value: "payPeriod", label: "Pay Period" },
  { value: "custom", label: "Custom Range" },
  { value: "relative", label: "Relative" },
];

const RELATIVE_DAYS = [7, 14, 30, 60, 90];

interface PayPeriodOption {
  id: string;
  startDate: string | Date;
  endDate: string | Date;
  status: string;
}

export function DateRangePicker({
  value,
  onChange,
  payPeriods,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  payPeriods: PayPeriodOption[];
}) {
  function pickKind(kind: string) {
    if (kind === "payPeriod" && payPeriods[0]) {
      onChange({ type: "payPeriod", payPeriodId: payPeriods[0].id });
    } else if (kind === "custom") {
      onChange({ type: "custom", startDate: "", endDate: "" });
    } else {
      onChange({ type: "relative", relativeDays: 30 });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl
        items={RANGE_KINDS}
        value={value.type}
        onChange={pickKind}
        ariaLabel="Date range kind"
      />

      {value.type === "payPeriod" && (
        <Select
          value={value.payPeriodId}
          onChange={(e) => onChange({ type: "payPeriod", payPeriodId: e.target.value })}
          aria-label="Pay period"
          style={{ maxWidth: 320 }}
        >
          {payPeriods.map((pp) => {
            const start = new Date(pp.startDate).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            });
            const end = new Date(pp.endDate).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            });
            return (
              <option key={pp.id} value={pp.id}>
                {start} – {end} ({pp.status})
              </option>
            );
          })}
        </Select>
      )}

      {value.type === "custom" && (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(200px,46%)),1fr))] sm:max-w-[420px]">
          <Input
            type="date"
            label="From"
            value={value.startDate}
            onChange={(e) => onChange({ ...value, startDate: e.target.value })}
          />
          <Input
            type="date"
            label="To"
            value={value.endDate}
            onChange={(e) => onChange({ ...value, endDate: e.target.value })}
          />
        </div>
      )}

      {value.type === "relative" && (
        <SegmentedControl
          items={RELATIVE_DAYS.map((d) => ({ value: String(d), label: `Last ${d} days` }))}
          value={String(value.relativeDays)}
          onChange={(v) => onChange({ type: "relative", relativeDays: Number(v) })}
          ariaLabel="How far back"
        />
      )}
    </div>
  );
}
