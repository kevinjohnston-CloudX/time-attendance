"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "@/components/layout/navigation-progress";
import { CalendarCheck, Plus } from "lucide-react";
import { Button, EmptyState, LinkButton, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { AreaPanel, FactTiles, StatusBadge, countLine, hoursText, matches, useFacts, useStatusView } from "./setup/setup-ui";
import type { HolidayRuleRow } from "./holiday-rule-editor";

/**
 * The holiday rules list on the shared panel. A row opens the rule on its
 * own page (see HolidayRuleEditor).
 */

type PayCodeOption = { id: string; code: number | string; label: string };

function pay(rule: HolidayRuleRow, payCode: Map<string, PayCodeOption>): { main: string; note?: string } {
  const main =
    rule.creditMethod === "FIXED_HOURS"
      ? `${hoursText(rule.creditMinutes)} a holiday`
      : rule.creditMethod === "SCHEDULED_HOURS"
        ? "The scheduled hours"
        : "The hours worked";
  const pc = rule.payCodeId ? payCode.get(rule.payCodeId) : undefined;
  return { main, note: pc ? `Pay code ${pc.code} ${pc.label}` : undefined };
}

/** What someone must work around the holiday, in the editor's words. */
function mustWork(rule: HolidayRuleRow): string {
  const parts = [
    rule.requireDayBefore && rule.requireDayAfter ? "The day before and after" : rule.requireDayBefore ? "The day before" : rule.requireDayAfter ? "The day after" : null,
    rule.requireDayBeforeOrAfter && "The day before or after",
    rule.requireDaysWorkedEnabled && `${rule.requireDaysWorkedCount} days before it`,
    rule.requireScheduledHoursPct && `${rule.requireScheduledHoursPctValue}% of scheduled hours`,
    rule.mustNotWorkOnHoliday && "Not the holiday itself",
  ].filter(Boolean) as string[];
  return parts.length ? parts.join(", ") : "No condition";
}

export function HolidayRulesManager({ rules, payCodes = [] }: { rules: HolidayRuleRow[]; payCodes?: PayCodeOption[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const { view, setView, counts, kept } = useStatusView(rules);
  const facts = useFacts(kept, [
    { key: "people", label: "Employees", note: "On these rules", value: kept.reduce((n, r) => n + (r._count?.employees ?? 0), 0) },
    { key: "holidays", label: "Holidays linked", note: "Paid by these rules", value: kept.reduce((n, r) => n + (r.assignedHolidays?.length ?? 0), 0) },
    { key: "premium", label: "Extra pay if worked", note: "More than 1× pay", match: (r) => r.workingPremium > 100 },
    { key: "conditions", label: "Work conditions", note: "Must work around the holiday", match: (r) => mustWork(r) !== "No condition" },
    { key: "unlinked", label: "No holidays", note: "Not linked to any holiday", match: (r) => !(r.assignedHolidays?.length ?? 0) },
  ]);
  const shown = facts.kept.filter((r) => matches(query, r.name, r.number));
  const payCode = new Map(payCodes.map((p) => [p.id, p]));

  const addButton = (
    <LinkButton href="/admin/rules-setup/holiday-rules/new" hierarchy="primary" leadingIcon={<Plus className="h-4 w-4" />}>
      Add holiday rule
    </LinkButton>
  );

  return (
    <AreaPanel
      title="Holiday rules"
      hint="How holiday pay is worked out and who qualifies. Each holiday is paid by the rules it is linked to."
      action={addButton}
      summary={rules.length ? <FactTiles tiles={facts.tiles} onToggle={facts.toggle} /> : undefined}
      status={{ view, onChange: setView, counts }}
      search={rules.length ? { value: query, onChange: setQuery, placeholder: "Rule name or number" } : undefined}
      count={countLine(shown.length, rules.length, "holiday rule", "holiday rules")}
    >
      {rules.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck className="h-8 w-8" />}
          title="No holiday rules yet"
          body="Add the first one, then link it to holidays in Company Setup."
          action={addButton}
        />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck className="h-8 w-8" />}
          title="No holiday rules match"
          body="Nothing matches the search, status or figure picked above."
          action={
            facts.focused || query ? (
              <Button hierarchy="secondary" size="sm" onClick={() => { facts.clear(); setQuery(""); }}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH numeric style={{ width: 48 }}>
                No.
              </TH>
              <TH>Holiday rule</TH>
              <TH>Pays</TH>
              <TH numeric>If worked</TH>
              <TH>Must work</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {shown.map((r) => {
              const people = r._count?.employees ?? 0;
              const holidays = r.assignedHolidays?.length ?? 0;
              const p = pay(r, payCode);
              return (
                <TR key={r.id} onClick={() => router.push(`/admin/rules-setup/holiday-rules/${r.id}`)}>
                  <TD numeric style={{ fontWeight: "var(--weight-semibold)" }}>
                    {r.number ?? ""}
                  </TD>
                  <TD>
                    <span className="flex flex-col" style={{ maxWidth: 260, whiteSpace: "normal" }}>
                      <Link
                        href={`/admin/rules-setup/holiday-rules/${r.id}`}
                        onClick={(e) => e.stopPropagation()}
                        style={{ fontWeight: "var(--weight-medium)", color: "var(--text-primary)", textDecoration: "none" }}
                      >
                        {r.name}
                      </Link>
                      <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                        {people.toLocaleString()} {people === 1 ? "employee" : "employees"} · {holidays} {holidays === 1 ? "holiday" : "holidays"}
                      </span>
                    </span>
                  </TD>
                  <TD>
                    <span className="flex flex-col">
                      <span style={{ color: "var(--text-primary)" }}>{p.main}</span>
                      {p.note && <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>{p.note}</span>}
                    </span>
                  </TD>
                  <TD numeric style={{ color: "var(--text-secondary)" }}>
                    {(r.workingPremium / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}× pay
                  </TD>
                  <TD style={{ color: "var(--text-secondary)", maxWidth: 220, whiteSpace: "normal" }}>{mustWork(r)}</TD>
                  <TD>
                    <StatusBadge active={r.isActive} />
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </AreaPanel>
  );
}
