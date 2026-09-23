"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/components/layout/navigation-progress";
import { format, parseISO } from "date-fns";
import { createLeaveRequest, submitLeaveRequest } from "@/actions/leave.actions";
import { LeaveDayPicker, type DaySelection, type ShiftInfo } from "./leave-day-picker";
import {
  Banner,
  Button,
  Card,
  LinkButton,
  PageHeader,
  Select,
  Textarea,
} from "@/components/ui";

/**
 * Request Leave, on the design's document template: a header carrying the two
 * page actions, then Request / Select Days / Note as titled cards down a
 * 720px column.
 *
 * <p>The primary action lives in the page header, which is why this component
 * renders the header rather than the route does — "Submit Request" has to know
 * whether a day is selected and whether a submit is already in flight, and
 * that state is here.
 *
 * <p>Filing is still two server calls, create then submit. Keeping them in
 * that order matters: the draft is what the accrual check runs against, so a
 * request that fails validation fails before it ever reaches a supervisor.
 */

interface Props {
  leaveTypes: { id: string; name: string }[];
  shift: ShiftInfo | null;
  /** Modal layout drops the page header and puts the submit at the foot. */
  layout?: "page" | "modal";
  onSuccess?: () => void;
}

/** cols=3 of the design's field grid: repeat(auto-fit, minmax(min(100%, max(200px, 96/cols %)), 1fr)). */
const FIELD_GRID =
  "grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(200px,32%)),1fr))]";

export function RequestLeaveForm({ leaveTypes, shift, layout = "page", onSuccess }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [leaveTypeId, setLeaveTypeId] = useState(leaveTypes[0]?.id ?? "");
  const [selectedDays, setSelectedDays] = useState<DaySelection[]>([]);
  const [note, setNote] = useState("");

  const isPage = layout === "page";

  // First and last day are read-outs, not inputs. The days come from the
  // picker — a pair of date fields beside it could disagree with it, and the
  // one that gets filed is the picker's.
  const dates = selectedDays.map((d) => d.date).sort();
  const firstDay = dates[0] ? format(parseISO(dates[0]), "EEE, d MMM yyyy") : "—";
  const lastDay = dates.at(-1) ? format(parseISO(dates.at(-1)!), "EEE, d MMM yyyy") : "—";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedDays.length === 0) {
      setError("Select at least one day.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const createResult = await createLeaveRequest({
        leaveTypeId,
        selectedDays,
        note: note || undefined,
      });

      if (!createResult.success) {
        setError(createResult.error);
        return;
      }

      const submitResult = await submitLeaveRequest({
        leaveRequestId: createResult.data.id,
      });

      if (!submitResult.success) {
        setError(submitResult.error);
        return;
      }

      if (onSuccess) {
        onSuccess();
      } else {
        router.push("/leave");
      }
    });
  }

  const submitButton = (
    <Button type="submit" disabled={isPending || selectedDays.length === 0}>
      {isPending ? "Submitting…" : "Submit Request"}
    </Button>
  );

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {isPage && (
        <PageHeader
          title="Request Leave"
          subtitle="Pick your days and send it for approval"
          actions={
            <>
              <LinkButton href="/leave" hierarchy="tertiary">
                ← My Leave
              </LinkButton>
              {submitButton}
            </>
          }
        />
      )}

      <div className="flex w-full flex-col gap-4" style={{ maxWidth: isPage ? 720 : undefined }}>
        {error && <Banner tone="error" body={error} />}

        <Card title="Request" subtitle="Balances update the moment a request is approved.">
          <div className={FIELD_GRID}>
            <label className="flex w-full flex-col gap-1.5">
              <span className="wms-label">Leave Type</span>
              <Select
                value={leaveTypeId}
                onChange={(e) => setLeaveTypeId(e.target.value)}
                required
                style={{ width: "100%" }}
              >
                {leaveTypes.map((lt) => (
                  <option key={lt.id} value={lt.id}>
                    {lt.name}
                  </option>
                ))}
              </Select>
            </label>

            <Kv label="First Day" value={firstDay} />
            <Kv label="Last Day" value={lastDay} />
          </div>
        </Card>

        <Card
          title="Select Days"
          subtitle="Pick the days you will be off. Hours follow your shift; switch a day to partial to take less."
        >
          <LeaveDayPicker value={selectedDays} onChange={setSelectedDays} shift={shift} />
        </Card>

        <Card title="Note" subtitle="Optional context for your supervisor.">
          {/* No `label` — the card header above it already says "Note", and
              the field would otherwise print the word twice, stacked. */}
          <Textarea
            aria-label="Note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Reason or additional context…"
          />
        </Card>

        {!isPage && <div className="flex justify-end">{submitButton}</div>}
      </div>
    </form>
  );
}

/** A label-over-value pair, as the design's document fields draw them. */
function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="wms-label">{label}</span>
      <span
        className="truncate"
        style={{
          font: "var(--type-body1)",
          fontWeight: "var(--weight-medium)",
          color: "var(--text-primary)",
          // Matches the 32px control beside it so the row's baselines line up.
          lineHeight: "32px",
        }}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}
