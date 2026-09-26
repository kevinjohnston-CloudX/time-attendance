"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "@/components/layout/navigation-progress";
import { Plus, SlidersHorizontal } from "lucide-react";
import type { RuleSet } from "@prisma/client";
import { Badge, EmptyState, LinkButton, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { AreaPanel, StatusBadge, countLine, hoursText, matches, useStatusView, type StatusView } from "./setup/setup-ui";
import { PAY_FREQUENCIES, type RuleSetRow } from "./rule-set-editor";

/** `?view=` on arrival, which the hub's "1 inactive" link uses; Active otherwise. */
function asView(raw: string | undefined): StatusView {
  return raw === "all" || raw === "inactive" ? raw : "active";
}

/** Stored "off" values: a day or a week longer than any shift can reach. */
const DAY_OFF = 1440;
const WEEK_OFF = 86400;

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

/**
 * The three columns that say what a rule set does.
 *
 * <p>These read the same fields the editor writes, so a row and the form
 * behind it can never disagree. Thresholds are minutes, with a full day
 * (daily) or 60 days (weekly) standing for "off". The old summary treated
 * anything past 24 hours as off, so every weekly threshold, 40 hours
 * included, read "OT after disabled/week".
 */
function payCycle(rs: RuleSet): { main: string; note?: string } {
  if (!rs.payFrequency) return { main: "Company default" };
  const label = PAY_FREQUENCIES.find((f) => f.value === rs.payFrequency)?.label ?? rs.payFrequency;
  const [main, note] = label.split(" (");
  return { main, note: note?.replace(/\)$/, "") };
}

/**
 * The window weekly overtime is counted in, as the overtime engine picks it:
 * the calendar week unless a longer cycle has an anchor date to count from.
 */
function otWindow(rs: RuleSet): { days: number; words: string } {
  const cycle = rs.otCycle && rs.otCycle !== "WEEKLY" && rs.otCycleAnchorDate ? rs.otCycle : "WEEKLY";
  const days = cycle === "WEEKLY" ? 7 : cycle === "BIWEEKLY" ? 14 : (rs.otCycleDays ?? 14);
  return { days, words: days === 7 ? "a week" : days === 14 ? "per 2 weeks" : `per ${days} days` };
}

function overtime(rs: RuleSet): { main: string; note?: string } {
  const win = otWindow(rs);
  // More hours than the window holds can never be reached, so it reads as off.
  const reachable = (mins: number) => mins < win.days * 1440;
  const ot: string[] = [];
  if (rs.dailyOtMinutes < DAY_OFF) ot.push(`${hoursText(rs.dailyOtMinutes)} a day`);
  if (rs.weeklyOtEnabled && reachable(rs.weeklyOtMinutes)) ot.push(`${hoursText(rs.weeklyOtMinutes)} ${win.words}`);
  const dt: string[] = [];
  if (rs.dailyDtMinutes < DAY_OFF) dt.push(`${hoursText(rs.dailyDtMinutes)} a day`);
  if (rs.weeklyOtEnabled && rs.weeklyDtMinutes < WEEK_OFF && reachable(rs.weeklyDtMinutes)) dt.push(`${hoursText(rs.weeklyDtMinutes)} ${win.words}`);
  const notes = [dt.length ? `Double time after ${dt.join(" or ")}` : "", rs.consecutiveDayOtEnabled ? `${ordinal(rs.consecutiveDayOtDay)} day in a row` : ""].filter(Boolean);
  if (!ot.length && !notes.length) return { main: "No overtime" };
  return { main: ot.length ? `After ${ot.join(" or ")}` : "Premium days only", note: notes.join(" · ") || undefined };
}

function meal(rs: RuleSet): { main: string; note: string } {
  // Auto deduct takes the meal off the clock whether or not it was punched,
  // so it is the half of this setting someone reading the list needs.
  return {
    main: `${rs.mealBreakMinutes} min after ${hoursText(rs.mealBreakAfterMinutes)}`,
    note: rs.autoDeductMeal ? "Deducted automatically" : "Punched",
  };
}

/** One cell line with an optional quiet line under it. */
function TwoLine({ main, note, width }: { main: string; note?: string; width?: number }) {
  // A width lets a long note wrap; the kit's table otherwise sizes every
  // column to its longest line and the panel scrolls sideways.
  return (
    <span className="flex flex-col" style={width ? { maxWidth: width, whiteSpace: "normal" } : undefined}>
      <span style={{ color: "var(--text-primary)" }}>{main}</span>
      {note && <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>{note}</span>}
    </span>
  );
}

/**
 * The rule sets list on the shared panel. A row opens the rule set on its
 * own page (see RuleSetEditor), where it is edited and deleted.
 */
export function RuleSetsManager({ ruleSets, initialView }: { ruleSets: RuleSetRow[]; initialView?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const { view, setView, counts, kept } = useStatusView(ruleSets, asView(initialView));
  const shown = kept.filter((rs) => matches(query, rs.name, rs.number));

  const addButton = (
    <LinkButton href="/admin/rules-setup/rule-sets/new" hierarchy="primary" leadingIcon={<Plus className="h-4 w-4" />}>
      Add rule set
    </LinkButton>
  );

  return (
    <AreaPanel
      title="Rule sets"
      hint="The overtime, rounding and meal rules a pay period is calculated with. Each employee is on one."
      action={addButton}
      status={{ view, onChange: setView, counts }}
      search={ruleSets.length ? { value: query, onChange: setQuery, placeholder: "Rule set name or number" } : undefined}
      count={countLine(shown.length, ruleSets.length, "rule set", "rule sets")}
    >
      {ruleSets.length === 0 ? (
        <EmptyState
          icon={<SlidersHorizontal className="h-8 w-8" />}
          title="No rule sets yet"
          body="Nothing is calculated until one exists. Add the first one to set overtime, rounding and meals."
          action={addButton}
        />
      ) : shown.length === 0 ? (
        <EmptyState icon={<SlidersHorizontal className="h-8 w-8" />} title="No rule sets match" body="Nothing matches that search or status." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH numeric style={{ width: 48 }}>
                No.
              </TH>
              <TH>Rule set</TH>
              <TH>Pay cycle</TH>
              <TH>Overtime</TH>
              <TH>Meal</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {shown.map((rs) => {
              const people = rs._count?.employees ?? 0;
              return (
                <TR key={rs.id} onClick={() => router.push(`/admin/rules-setup/rule-sets/${rs.id}`)}>
                  <TD numeric style={{ fontWeight: "var(--weight-semibold)" }}>
                    {rs.number ?? ""}
                  </TD>
                  <TD>
                    <span className="flex flex-col" style={{ maxWidth: 220, whiteSpace: "normal" }}>
                      <span className="flex items-baseline gap-2">
                        <Link
                          href={`/admin/rules-setup/rule-sets/${rs.id}`}
                          onClick={(e) => e.stopPropagation()}
                          style={{ fontWeight: "var(--weight-medium)", color: "var(--text-primary)", textDecoration: "none" }}
                        >
                          {rs.name}
                        </Link>
                        {rs.isDefault && (
                          <Badge tone="info" size="sm">
                            Default
                          </Badge>
                        )}
                      </span>
                      <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                        {people ? `${people.toLocaleString()} ${people === 1 ? "employee" : "employees"}` : "No employees"}
                      </span>
                    </span>
                  </TD>
                  <TD>
                    <TwoLine {...payCycle(rs)} />
                  </TD>
                  <TD>
                    <TwoLine {...overtime(rs)} width={208} />
                  </TD>
                  <TD>
                    <TwoLine {...meal(rs)} />
                  </TD>
                  <TD>
                    <StatusBadge active={rs.isActive} />
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
