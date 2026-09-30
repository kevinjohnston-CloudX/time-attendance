"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/components/layout/navigation-progress";
import { requestMissedPunch } from "@/actions/punch.actions";
import { PUNCH_TYPE_LABEL, type PunchTypeValue } from "@/lib/state-machines/labels";
import { Banner, Button, Card, Input, LinkButton, PageHeader, Select, Textarea } from "@/components/ui";

/**
 * Report Missed Punch, on the portal design's document template: a callout,
 * then the fields in titled cards, in a column 640px wide.
 *
 * <p>The page header is rendered here, inside the form element, because the
 * template puts the primary action in the header. Keeping the whole screen
 * inside one `form` means "Submit Request" is an ordinary submit button that
 * the browser wires up — it validates the required fields, and Enter in a
 * field still sends the request.
 *
 * <p>The design also shows a Reason Code select and a table of the employee's
 * recent requests. Neither is here: nothing in this app stores a reason code
 * against a punch, and the request list would need a query this screen does
 * not run. Both are in the handoff report.
 */

const PUNCH_TYPES: PunchTypeValue[] = [
  "CLOCK_IN",
  "CLOCK_OUT",
  "MEAL_START",
  "MEAL_END",
  "BREAK_START",
  "BREAK_END",
];

/** The design's column width for this screen, and its two-up field grid. */
const DOC_WIDTH = 640;
const FIELD_GRID = "grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(200px,48%)),1fr))]";

export function MissedPunchForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const punchType = fd.get("punchType") as PunchTypeValue;
    const punchTime = fd.get("punchTime") as string;
    const note = fd.get("note") as string;

    startTransition(async () => {
      const result = await requestMissedPunch({
        punchType,
        punchTime: new Date(punchTime).toISOString(),
        note,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.push("/time/history");
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <PageHeader pinned
        title="Report Missed Punch"
        subtitle="Submit a missed punch for supervisor approval"
        actions={
          <>
            <LinkButton href="/time/history" hierarchy="tertiary">
              ← Punch History
            </LinkButton>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Submitting…" : "Submit Request"}
            </Button>
          </>
        }
      />

      <div className="flex w-full flex-col gap-4" style={{ maxWidth: DOC_WIDTH }}>
        {/* The two swap rather than stack. The callout explains what happens
            next; once the request has failed, what happens next is that it did
            not, and two notices at the top of a form is how neither is read. */}
        {error ? (
          <Banner tone="error" title="Request not sent" body={error} />
        ) : (
          <Banner
            tone="info"
            body="Submitted requests go to your supervisor. The punch appears on your timesheet once approved."
          />
        )}

        <Card
          title="Missed Punch"
          subtitle="Choose the punch you missed and when it should have happened."
        >
          <div className={FIELD_GRID}>
            {/* The kit's Select has no label prop, so the label, the required
                mark and the hint are the same three parts Input builds, laid
                out the same way — otherwise the two columns sit at different
                heights. */}
            <div className="flex w-full flex-col gap-1.5">
              <label
                htmlFor="punchType"
                style={{ font: "var(--type-button2)", color: "var(--text-secondary)" }}
              >
                Punch Type
                <span aria-hidden="true" style={{ color: "var(--text-error)", marginLeft: 3 }}>
                  *
                </span>
              </label>
              <Select id="punchType" name="punchType" required style={{ width: "100%" }}>
                {PUNCH_TYPES.map((pt) => (
                  <option key={pt} value={pt}>
                    {PUNCH_TYPE_LABEL[pt]}
                  </option>
                ))}
              </Select>
              <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                Which scan is missing from the day.
              </span>
            </div>

            <Input
              type="datetime-local"
              name="punchTime"
              label="Date & Time"
              required
              hint="When the punch should have been recorded."
            />
          </div>
        </Card>

        <Card title="Explanation" subtitle="Required. Your supervisor will read this.">
          <Textarea
            name="note"
            label="Note"
            required
            rows={4}
            placeholder="Explain why this punch was missed"
            hint="The note stays on the punch, so it is still there when the timecard is audited."
          />
        </Card>
      </div>
    </form>
  );
}
