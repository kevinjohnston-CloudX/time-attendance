import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { findOpenPayPeriod } from "@/lib/utils/punch-helpers";
import { PunchHistoryTable } from "@/components/time/punch-history-table";
import { Card, LinkButton, PageHeader, Toolbar } from "@/components/ui";
import { format, addDays } from "date-fns";
import { parseUtcDate } from "@/lib/utils/date";

/**
 * Punch History, on the portal design's list template: header, a toolbar
 * carrying the record count, then one card holding the table.
 *
 * <p>There are no view tabs and no filter chips, because this list has nothing
 * to filter by. It is one employee's own punches inside the open pay period —
 * the department, shift and site chips the design gives its other lists would
 * all resolve to the same single value, and a period picker would mean
 * querying periods this page does not load.
 *
 * <p>The count moved from the subtitle into the toolbar, where the design puts
 * it. The subtitle keeps the pay period: on a screen full of times, the thing
 * that makes one wrong is usually the period it belongs to.
 */
export default async function PunchHistoryPage() {
  const session = await auth();
  if (!session?.user?.employeeId) redirect("/dashboard");

  const { employeeId } = session.user;

  // Resolve the employee's rule set so we find the right pay period
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: { ruleSetId: true, tenantId: true },
  });

  const payPeriod = employee
    ? await findOpenPayPeriod(employee.tenantId, employee.ruleSetId)
    : null;

  const punches = payPeriod
    ? await db.punch.findMany({
        where: {
          employeeId,
          isRejected: false,
          timesheet: { payPeriodId: payPeriod.id },
        },
        orderBy: { punchTime: "desc" },
      })
    : [];

  // endDate is the exclusive bound the pay period runs up to, so the last day
  // people worked is the day before it.
  const periodLabel = payPeriod
    ? `${format(parseUtcDate(payPeriod.startDate), "MMM d, yyyy")} – ${format(
        addDays(parseUtcDate(payPeriod.endDate), -1),
        "MMM d, yyyy",
      )}`
    : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Punch History"
        subtitle={
          periodLabel ? (
            <>Pay period {periodLabel} · every punch with its source and approval state</>
          ) : (
            <span style={{ color: "var(--text-warning)" }}>
              No open pay period · nothing to show until payroll opens the next one
            </span>
          )
        }
        actions={
          <LinkButton href="/time/missed-punch" hierarchy="secondary">
            Report Missed Punch
          </LinkButton>
        }
      />

      {/* "punch record" rather than "punch": the toolbar pluralises by adding
          an s, and "12 punchs" is how a count stops being trusted. */}
      <Toolbar count={punches.length} countLabel="punch record" />

      <Card padding={0}>
        <PunchHistoryTable
          punches={punches}
          showNote
          footerLabel={punches.length === 1 ? "punch" : "punches"}
          // Which of the two empty lists this is decides what someone does
          // next: chase a missing scan, or wait for payroll.
          emptyTitle={payPeriod ? "No punches this pay period" : "No open pay period"}
          emptyBody={
            payPeriod
              ? `Nothing has been recorded against ${periodLabel}. Punches taken at a clock or on the web appear here straight away.`
              : "Punch history is scoped to the pay period that is open. Payroll has not opened one, so there is nothing to list yet."
          }
        />
      </Card>
    </div>
  );
}
