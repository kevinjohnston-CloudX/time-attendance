"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { ClipboardCheck } from "lucide-react";
import { useRouter } from "@/components/layout/navigation-progress";
import { Button, Checkbox, FilterSelectChip, LinkButton, SearchInput, ToolsBar, ToolsCount } from "@/components/ui";
import { DecisionButtons, DecisionNote, useEditDecision } from "@/components/payroll/edit-requests-panel";
import type { PendingTimecardEdit, TimecardEditPreview } from "@/actions/timecard-edit.actions";

/**
 * Timecard edits on the Approvals page (11/11; grouped 11/12): one card per
 * person and pay period with supervisor changes waiting for HR, however many
 * Saves they came in, oldest waiting first; and the one picked beside its
 * timecard on the right, where Leave requests shows its calendar. HR decides
 * the timecard's changes together there, unticking any to turn down; a
 * supervisor sees their team's and may take one back. The pick is kept in the
 * address (?timesheet=), so it survives a reload and the list moves past it
 * once it is decided.
 */
export function TimecardEditsScreen({
  requests,
  selectedId,
  preview,
  mode,
}: {
  requests: PendingTimecardEdit[];
  /** The timecard picked. */
  selectedId: string | null;
  preview: TimecardEditPreview | null;
  /** decide: HR and payroll; send: a supervisor. */
  mode: "decide" | "send";
}) {
  const router = useRouter();
  const pick = (id: string) => router.push(`/approvals?view=timecards&timesheet=${id}`);

  // Search and filters as Leave requests has them (John, 11/11). The list is
  // already only what this person may see, so they narrow it on screen, and
  // each filter offers only what is in it.
  const [query, setQuery] = useState("");
  const [site, setSite] = useState("");
  const [department, setDepartment] = useState("");
  const [sender, setSender] = useState("");
  const options = (values: string[]) => [...new Set(values)].sort().map((v) => ({ id: v, name: v }));
  const needle = query.trim().toLowerCase();
  const shown = requests.filter((r) =>
    (!needle || r.employeeName.toLowerCase().includes(needle) || r.employeeCode.toLowerCase().includes(needle)) &&
    (!site || r.siteName === site) &&
    (!department || r.departmentName === department) &&
    (!sender || r.senders.includes(sender)),
  );
  const filtered = !!(needle || site || department || sender);
  const clearAll = () => { setQuery(""); setSite(""); setDepartment(""); setSender(""); };

  return (
    <div className="flex flex-col gap-3">
      {requests.length > 0 && (
        <ToolsBar
          search={<SearchInput placeholder="Employee name or ID" value={query} onValueChange={setQuery} />}
          end={
            <>
              {filtered && (
                <Button hierarchy="link" size="sm" onClick={clearAll}>
                  Clear all
                </Button>
              )}
              <ToolsCount>
                {shown.length} {shown.length === 1 ? "timecard" : "timecards"}
              </ToolsCount>
            </>
          }
        >
          <FilterSelectChip label="Department" value={department} options={options(requests.map((r) => r.departmentName))} onChange={setDepartment} />
          <FilterSelectChip label="Site" value={site} options={options(requests.map((r) => r.siteName))} onChange={setSite} />
          <FilterSelectChip label="Sent by" value={sender} options={options(requests.flatMap((r) => r.senders))} onChange={setSender} />
        </ToolsBar>
      )}
      <div className="grid grid-cols-1 items-start gap-4 lg:[grid-template-columns:minmax(320px,400px)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-2.5">
          {requests.length > 0 && shown.length === 0 ? (
            <div
              className="flex flex-col items-center gap-2.5 px-6 py-12 text-center"
              style={{ border: "1px solid var(--stroke-secondary)", borderRadius: 12, background: "var(--surface-card)" }}
            >
              <div style={{ font: "var(--type-h4)" }}>No matching timecards</div>
              <div className="max-w-80" style={{ font: "var(--type-body1)", color: "var(--text-secondary)" }}>
                Nothing waiting matches the search and filters. Clear them to see the rest.
              </div>
              <Button hierarchy="secondary" size="sm" onClick={clearAll}>Clear all</Button>
            </div>
          ) : requests.length === 0 ? (
            <div
              className="flex flex-col items-center gap-2.5 px-6 py-12 text-center"
              style={{ border: "1px solid var(--stroke-secondary)", borderRadius: 12, background: "var(--surface-card)" }}
            >
              <span style={{ color: "var(--icon-disabled)" }}>
                <ClipboardCheck className="h-8 w-8" />
              </span>
              <div style={{ font: "var(--type-h4)" }}>No timecard edits waiting</div>
              <div className="max-w-80" style={{ font: "var(--type-body1)", color: "var(--text-secondary)" }}>
                {mode === "decide"
                  ? "When supervisors change a timecard, their changes wait here for you to approve."
                  : "Changes you make on your team's timecards wait here until a manager or HR approves them."}
              </div>
            </div>
          ) : (
            shown.map((r) => {
              const selected = r.timesheetId === selectedId;
              return (
                <div
                  key={r.timesheetId}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  onClick={() => pick(r.timesheetId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      pick(r.timesheetId);
                    }
                  }}
                  className="flex cursor-pointer flex-col gap-1.5 p-4"
                  style={{
                    border: `1px solid ${selected ? "var(--stroke-accent)" : "var(--stroke-secondary)"}`,
                    borderRadius: 10,
                    background: selected ? "var(--surface-info)" : "var(--surface-card)",
                    transition: "border-color 140ms ease, background 140ms ease",
                  }}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate" style={{ font: "var(--weight-semibold) 15px/20px var(--font-sans)", color: "var(--text-primary)" }}>
                      {r.employeeName}
                    </span>
                    <span className="flex-none tabular" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                      {r.count} {r.count === 1 ? "change" : "changes"}
                    </span>
                  </div>
                  <span className="truncate" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                    {r.employeeCode} · {r.siteName} · {r.departmentName}
                  </span>
                  <span style={{ font: "var(--type-body2)", color: "var(--text-primary)" }}>
                    Pay period {r.periodLabel}
                  </span>
                  <span className="truncate" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                    From {r.senders.join(", ")} · waiting since {format(parseISO(r.oldestAt), "MMM d, h:mm a")}
                  </span>
                </div>
              );
            })
          )}
        </div>

        <div className="min-w-0">
          {preview ? (
            <Preview key={preview.items.map((i) => i.id + i.updatedAt).join()} preview={preview} mode={mode} onChanged={() => router.refresh()} />
          ) : requests.length > 0 ? (
            <div
              className="flex items-center justify-center px-6 py-12 text-center"
              style={{ border: "1px dashed var(--stroke-secondary)", borderRadius: 12, font: "var(--type-body1)", color: "var(--text-secondary)" }}
            >
              Pick a timecard to see its changes.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type Day = TimecardEditPreview["days"][number];
type Shown = NonNullable<Day["pairs"][number]["in"]>;

const hoursCell = (minutes: number) => (minutes ? (minutes / 60).toFixed(2) : "—");

/** One punch in a Clock in or Clock out cell: blue while waiting for HR, struck through when removed. */
function PunchCell({ p }: { p: Shown | null }) {
  if (!p) return <span style={{ color: "var(--text-disabled)" }}>—</span>;
  if (p.hoursOnly) return <span title="Hours entered with Add time, not clock times." style={{ color: "var(--text-disabled)" }}>—</span>;
  return (
    <span
      className="tabular whitespace-nowrap"
      title={
        p.waiting === "add" ? "Added, waiting for approval"
          : p.waiting === "change" ? `Changed from ${p.was}, waiting for approval`
          : p.waiting === "remove" ? "Removed, waiting for approval"
          : undefined
      }
      style={{
        color: p.waiting ? "var(--text-accent)" : "var(--text-primary)",
        fontWeight: p.waiting ? "var(--weight-semibold)" : undefined,
        textDecoration: p.waiting === "remove" ? "line-through" : undefined,
      }}
    >
      {p.time}
    </span>
  );
}

/** The changes column's width, shared by its heading and every row, so they line up. */
const CHANGE_W = 250;

/**
 * The timecard with every change waiting on it, laid out as the timecard is:
 * a row a day with its clock in and out (another shift that day on a row of
 * its own), Regular, Overtime, Double, Total and the pay code. Each change
 * sits on its day with the reason it was sent with; HR unticks any to turn
 * down and decides them all with one button, and a supervisor may take one back.
 */
function Preview({ preview, mode, onChanged }: { preview: TimecardEditPreview; mode: "decide" | "send"; onChanged: () => void }) {
  const { employee, days } = preview;
  const d = useEditDecision(preview.timesheetId, preview.items, onChanged);
  const count = preview.items.length;
  const th = { fontWeight: "var(--weight-medium)", font: "var(--type-caption1)", letterSpacing: "0.04em", textTransform: "uppercase" as const, color: "var(--text-secondary)" };

  return (
    <div className="flex flex-col" style={{ border: "1px solid var(--stroke-secondary)", borderRadius: 12, background: "var(--surface-card)", overflow: "hidden" }}>
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-3" style={{ borderBottom: "1px solid var(--stroke-divider)" }}>
        <div className="flex min-w-0 flex-col">
          <span style={{ font: "var(--type-h4)", color: "var(--text-primary)" }}>{employee.name}</span>
          <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
            {employee.code} · {employee.site} · {employee.department} · {preview.periodLabel}
          </span>
        </div>
        <LinkButton href={`/payroll/timecards?employeeId=${employee.id}&periodId=${preview.periodId}`} hierarchy="secondary" size="sm">
          Open timecard
        </LinkButton>
      </div>

      {/* How many, from whom, and the one decision for them all. */}
      <div className="flex flex-col gap-2 px-4 py-3" style={{ borderBottom: "1px solid var(--stroke-divider)", background: "var(--surface-info)" }}>
        {count > 0 ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="min-w-0 flex-1" style={{ font: "var(--type-body2)", color: "var(--text-primary)" }}>
              <strong style={{ fontWeight: "var(--weight-semibold)" }}>{count} {count === 1 ? "change" : "changes"}</strong> waiting for approval from {preview.senders.join(", ")}
              {mode === "decide" ? ". Untick any to turn down." : "."}
            </span>
            {mode === "decide" && <DecisionButtons d={d} />}
          </div>
        ) : (
          <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>These changes were decided or taken back.</span>
        )}
        <DecisionNote d={d} />
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="w-full" style={{ borderCollapse: "collapse", font: "var(--type-body1)" }}>
          <thead>
            <tr style={{ textAlign: "left" }}>
              <th className="px-4 py-2" style={th}>Day</th>
              <th className="px-2 py-2" style={th}>Clock in</th>
              <th className="px-2 py-2" style={th}>Clock out</th>
              <th className="px-2 py-2 text-right" style={th}>Regular</th>
              <th className="px-2 py-2 text-right" style={th}>Overtime</th>
              <th className="px-2 py-2 text-right" style={th}>Double</th>
              <th className="px-2 py-2 text-right" style={th}>Total</th>
              <th className="px-3 py-2" style={th}>Pay code</th>
              <th className="py-2 pl-3" style={{ ...th, width: CHANGE_W }}>{mode === "decide" ? "Approve" : "Waiting for approval"}</th>
              <th className="py-2 pl-2 pr-4" style={th}>Comment</th>
            </tr>
          </thead>
          <tbody>
            {days.flatMap((day) => {
              const pairs = day.pairs.length ? day.pairs : [{ in: null, out: null }];
              const waitingHere = day.items.length > 0;
              return pairs.map((pair, k) => (
                <tr
                  key={`${day.day}-${k}`}
                  style={{
                    borderTop: k === 0 ? "1px solid var(--stroke-divider)" : undefined,
                    background: waitingHere ? "var(--surface-info)" : undefined,
                    verticalAlign: "top",
                  }}
                >
                  <td className="whitespace-nowrap px-4 py-2" style={{ color: "var(--text-primary)", fontWeight: k === 0 ? "var(--weight-semibold)" : undefined }}>
                    {k === 0 ? day.label : <span className="ml-4" style={{ color: "var(--text-disabled)" }}>↳</span>}
                  </td>
                  <td className="px-2 py-2"><PunchCell p={pair.in} /></td>
                  <td className="px-2 py-2"><PunchCell p={pair.out} /></td>
                  <td className="tabular px-2 py-2 text-right" style={{ color: day.reg && k === 0 ? "var(--text-primary)" : "var(--text-disabled)" }}>{k === 0 ? hoursCell(day.reg) : ""}</td>
                  <td className="tabular px-2 py-2 text-right" style={{ color: day.ot && k === 0 ? "var(--text-primary)" : "var(--text-disabled)" }}>{k === 0 ? hoursCell(day.ot) : ""}</td>
                  <td className="tabular px-2 py-2 text-right" style={{ color: day.dt && k === 0 ? "var(--text-primary)" : "var(--text-disabled)" }}>{k === 0 ? hoursCell(day.dt) : ""}</td>
                  <td className="tabular px-2 py-2 text-right" style={{ color: day.total && k === 0 ? "var(--text-primary)" : "var(--text-disabled)", fontWeight: "var(--weight-semibold)" }}>{k === 0 ? hoursCell(day.total) : ""}</td>
                  <td className="px-3 py-2" style={{ color: "var(--text-secondary)", font: "var(--type-body2)" }}>{k === 0 ? (day.codes.join(", ") || "—") : ""}</td>
                  {/* Each change and its comment side by side, on the day's first row. */}
                  <td colSpan={2} className="py-2 pl-3 pr-4" style={{ font: "var(--type-body2)" }}>
                    {k === 0 && day.items.length > 0 && (
                      <span className="grid items-center gap-x-2 gap-y-1" style={{ gridTemplateColumns: `${CHANGE_W - 12}px minmax(0, 1fr)` }}>
                        {day.items.map((i) => (
                          <span key={i.id} className="contents">
                            {mode === "decide" ? (
                              <Checkbox checked={d.approve.has(i.id)} onChange={(on) => d.toggle(i.id, on)} label={i.text} />
                            ) : (
                              <span className="flex flex-wrap items-center gap-2" style={{ color: "var(--text-primary)" }}>
                                {i.text}
                                <Button hierarchy="tertiary" size="sm" disabled={d.isPending} onClick={() => d.takeBack(i.id)}>Take back</Button>
                              </span>
                            )}
                            <span style={{ color: "var(--text-secondary)" }} title={`Sent ${format(parseISO(i.sentAt), "MMM d, h:mm a")}`}>
                              &ldquo;{i.reason}&rdquo;{preview.senders.length > 1 ? ` (${i.sender})` : ""}
                            </span>
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
      <p className="m-0 px-4 py-2.5" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)", borderTop: "1px solid var(--stroke-divider)" }}>
        Hours are as the timecard stands now. Times waiting for approval are in blue; they count once approved.
      </p>
    </div>
  );
}
