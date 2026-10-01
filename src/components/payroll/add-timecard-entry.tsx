"use client";

import { useState, useTransition } from "react";
import { addManualPunchPair, addPayrollLeaveEntry } from "@/actions/timecard-entry.actions";
import { minutesToHoursDecimal } from "@/lib/utils/duration";
import { fromSiteClock } from "@/lib/utils/date";
import { Banner, Button, Input, SegmentedControl, Select } from "@/components/ui";

/**
 * The inline "add an entry to this day" panel that opens inside a timecard row.
 *
 * <p>Two kinds of entry, not two forms on one screen: a manual punch pair needs
 * a reason because somebody is writing hours a clock never recorded, and a
 * leave entry needs a type and a duration because nobody was at work at all.
 * The segmented control is the design system's, so the choice reads as a view
 * of one panel rather than two competing submit buttons.
 *
 * <p>The wrapper swallows clicks. This panel is rendered inside a table row
 * whose own click handler expands and collapses the day, and without the guard
 * every keystroke in here would fold the panel away underneath itself.
 */

type LeaveTypeOption = {
  id: string;
  name: string;
  category: string;
  isPaid: boolean;
};

interface AddTimecardEntryProps {
  timesheetId: string;
  date: string; // yyyy-MM-dd
  leaveTypes: LeaveTypeOption[];
  onClose: () => void;
  onSuccess: () => void;
  /** The employee's site time zone: the times typed are that site's clock. */
  timezone: string;
}

export function AddTimecardEntry({
  timesheetId,
  date,
  leaveTypes,
  onClose,
  onSuccess,
  timezone,
}: AddTimecardEntryProps) {
  const [tab, setTab] = useState<"time" | "leave">("time");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Time entry state
  const [inTime, setInTime] = useState(`${date}T09:00`);
  const [outTime, setOutTime] = useState(`${date}T17:00`);
  const [reason, setReason] = useState("");

  // Leave entry state
  const [leaveTypeId, setLeaveTypeId] = useState(leaveTypes[0]?.id ?? "");
  const [durationHours, setDurationHours] = useState("8");
  const [leaveNote, setLeaveNote] = useState("");

  function handleAddTime(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await addManualPunchPair({
        timesheetId,
        date,
        inTime: fromSiteClock(new Date(inTime), timezone).toISOString(),
        outTime: fromSiteClock(new Date(outTime), timezone).toISOString(),
        reason,
      });
      if (!result.success) {
        setError((result as { success: false; error: string }).error);
        return;
      }
      onSuccess();
    });
  }

  function handleAddLeave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const durationMinutes = Math.round(parseFloat(durationHours) * 60);
    if (isNaN(durationMinutes) || durationMinutes <= 0) {
      setError("Duration must be greater than 0.");
      return;
    }
    startTransition(async () => {
      const result = await addPayrollLeaveEntry({
        timesheetId,
        date,
        leaveTypeId,
        durationMinutes,
        note: leaveNote || undefined,
      });
      if (!result.success) {
        setError((result as { success: false; error: string }).error);
        return;
      }
      onSuccess();
    });
  }

  const leavePreview =
    durationHours && !isNaN(parseFloat(durationHours))
      ? `${minutesToHoursDecimal(Math.round(parseFloat(durationHours) * 60))} h will be credited`
      : undefined;

  return (
    <div
      className="flex flex-col gap-3 rounded-lg p-3.5"
      style={{ border: "1px solid var(--stroke-accent-focus)", background: "var(--surface-info)" }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <SegmentedControl
          size="sm"
          ariaLabel="Kind of entry"
          value={tab}
          onChange={(next) => {
            setTab(next as "time" | "leave");
            setError(null);
          }}
          items={[
            { value: "time", label: "Add Time" },
            { value: "leave", label: "Add Leave" },
          ]}
        />
        <div className="flex-1" />
        <Button hierarchy="link" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>

      {error && <Banner tone="error" body={error} />}

      {tab === "time" && (
        <form onSubmit={handleAddTime} className="flex flex-wrap items-end gap-2.5">
          <div className="w-[196px] flex-none">
            <Input
              label="In"
              type="datetime-local"
              value={inTime}
              onChange={(e) => setInTime(e.target.value)}
              required
            />
          </div>
          <div className="w-[196px] flex-none">
            <Input
              label="Out"
              type="datetime-local"
              value={outTime}
              onChange={(e) => setOutTime(e.target.value)}
              required
            />
          </div>
          <div className="min-w-[220px] flex-1">
            <Input
              label="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this being added manually?"
              required
            />
          </div>
          <Button type="submit" disabled={isPending || !reason.trim()}>
            {isPending ? "Saving…" : "Add"}
          </Button>
        </form>
      )}

      {tab === "leave" && (
        <form onSubmit={handleAddLeave} className="flex flex-wrap items-end gap-2.5">
          <label className="flex w-[220px] flex-none flex-col gap-1.5">
            <span style={{ font: "var(--type-button2)", color: "var(--text-secondary)" }}>
              Leave Type
            </span>
            <Select
              value={leaveTypeId}
              onChange={(e) => setLeaveTypeId(e.target.value)}
              required
              style={{ width: "100%" }}
            >
              {leaveTypes.length === 0 && <option value="">No leave types configured</option>}
              {leaveTypes.map((lt) => (
                <option key={lt.id} value={lt.id}>
                  {lt.name}
                  {lt.isPaid ? "" : " (Unpaid)"}
                </option>
              ))}
            </Select>
          </label>
          <div className="w-[120px] flex-none">
            <Input
              label="Hours"
              type="number"
              min="0.25"
              max="24"
              step="0.25"
              value={durationHours}
              onChange={(e) => setDurationHours(e.target.value)}
              required
            />
          </div>
          <div className="min-w-[220px] flex-1">
            <Input
              label="Note (optional)"
              value={leaveNote}
              onChange={(e) => setLeaveNote(e.target.value)}
              placeholder="e.g. FMLA paperwork ref #…"
            />
          </div>
          <Button type="submit" disabled={isPending || !leaveTypeId || !durationHours}>
            {isPending ? "Saving…" : "Add"}
          </Button>
          {/* Decimal hours are what lands in the ledger, so they are echoed back
              rather than left for the reader to work out from "7.25". On its own
              line: a hint under the 120px field would push that field out of
              line with the rest of the row. */}
          {leavePreview && (
            <span
              className="tabular w-full"
              style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
            >
              {leavePreview}
            </span>
          )}
        </form>
      )}
    </div>
  );
}
