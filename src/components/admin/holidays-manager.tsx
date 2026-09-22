"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { CalendarDays, X } from "lucide-react";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { createHoliday, updateHoliday, deleteHoliday } from "@/actions/holiday.actions";
import {
  Badge,
  Banner,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Input,
  Select,
  SegmentedControl,
  Table,
  TBody,
  THead,
  TR,
  TH,
  TD,
  TableFooter,
  Toolbar,
  statusTone,
} from "@/components/ui";

/**
 * Holidays, on the design's list template.
 *
 * <p>The design's Holidays list carries Sites, Pay Code and Hours. All three
 * live on the holiday *rule*, not the holiday — one holiday can be assigned to
 * several rules that credit different hours — so this table shows how many
 * rules pick the day up and leaves the rest to the rule editor.
 *
 * <p>Year and status are local state, like the tab this manager sits in. The
 * whole screen was fetched in one round, so a filter in the query string would
 * re-run ten server actions to hide rows the browser already holds.
 */

interface HolidayRule { id: string; name: string; number?: number | null }

interface HolidayWithRules {
  id: string;
  name: string;
  date: Date | string;
  observedDate?: Date | string | null;
  isActive: boolean;
  bypassAfterEligibility: boolean;
  holidayRules?: { holidayRuleId: string }[];
}

interface Props {
  holidays: HolidayWithRules[];
  holidayRules: HolidayRule[];
}

type View = "all" | "active" | "inactive";

const VIEWS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

function toDateInputValue(date: Date | string): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  // Use UTC components to avoid local-timezone day shift
  return d.toISOString().slice(0, 10);
}

function formatUTCDate(date: Date | string, fmt: string): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  // Build a local-midnight Date from UTC components so date-fns format stays on the right day
  const utc = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return format(utc, fmt);
}

function SelectField({
  label,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  return (
    <label className="flex w-full flex-col gap-1.5">
      <span className="wms-label">{label}</span>
      <Select {...rest}>{children}</Select>
    </label>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="ta-modal max-h-[90vh] w-full max-w-2xl overflow-y-auto"
        style={{ borderRadius: "var(--radius-l)" }}
      >
        <header
          className="flex items-center justify-between gap-3 px-5 py-3.5"
          style={{ borderBottom: "1px solid var(--stroke-divider)" }}
        >
          <h3 style={{ margin: 0, font: "var(--type-h3)", color: "var(--text-primary)" }}>{title}</h3>
          <Button hierarchy="tertiary" size="sm" iconOnly onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/** A section inside the form dialog, where a nested Card would be a panel on a panel. */
function FormSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <span className="wms-overline">{label}</span>
      {children}
    </section>
  );
}

function ruleLabel(r: HolidayRule) {
  return r.number != null ? `${r.number} [${r.name}]` : r.name;
}

/** One side of the rule picker. */
function RuleList({
  title,
  rules,
  selected,
  emptyLabel,
  onToggle,
}: {
  title: string;
  rules: HolidayRule[];
  selected: string[];
  emptyLabel: string;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="min-w-0 flex-1">
      <p className="wms-label mb-1">{title}</p>
      <div
        className="h-40 w-full overflow-y-auto rounded-lg"
        style={{ border: "1px solid var(--stroke-default)", background: "var(--surface-card)" }}
      >
        {rules.length === 0 && (
          <p
            className="px-2.5 py-1"
            style={{ margin: 0, font: "var(--type-body2)", fontStyle: "italic", color: "var(--text-tertiary)" }}
          >
            {emptyLabel}
          </p>
        )}
        {rules.map((r) => {
          const on = selected.includes(r.id);
          return (
            <button
              key={r.id}
              type="button"
              aria-pressed={on}
              className={on ? "w-full px-2.5 py-1 text-left" : "ta-hoverable w-full px-2.5 py-1 text-left"}
              style={{
                border: "none",
                cursor: "pointer",
                userSelect: "none",
                font: "var(--type-body1)",
                background: on ? "var(--fill-accent)" : "transparent",
                color: on ? "var(--text-on-accent)" : "var(--text-primary)",
              }}
              onClick={() => onToggle(r.id)}
            >
              {ruleLabel(r)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Which holiday rules pick this day up.
 *
 * <p>A two-list picker rather than a checklist: a rule set can run to dozens of
 * rules, and the question asked here — "which of these already covers
 * Christmas" — is one a column of ticks answers only by reading every row.
 */
function DualListbox({
  allRules,
  selectedIds,
  onChange,
}: {
  allRules: HolidayRule[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [availSel, setAvailSel] = useState<string[]>([]);
  const [chosenSel, setChosenSel] = useState<string[]>([]);

  const available = allRules.filter((r) => !selectedIds.includes(r.id));
  const chosen = allRules.filter((r) => selectedIds.includes(r.id));

  function toggle(setter: (fn: (prev: string[]) => string[]) => void, id: string) {
    setter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function moveToChosen() {
    onChange([...selectedIds, ...availSel]);
    setAvailSel([]);
  }

  function moveToAvailable() {
    onChange(selectedIds.filter((id) => !chosenSel.includes(id)));
    setChosenSel([]);
  }

  function moveAllToChosen() {
    onChange(allRules.map((r) => r.id));
    setAvailSel([]);
  }

  function moveAllToAvailable() {
    onChange([]);
    setChosenSel([]);
  }

  return (
    <div className="flex items-center gap-2">
      <RuleList
        title="Available Items"
        rules={available}
        selected={availSel}
        emptyLabel="All rules assigned"
        onToggle={(id) => toggle(setAvailSel, id)}
      />

      <div className="flex flex-none flex-col items-center gap-1">
        <Button type="button" hierarchy="secondary" size="sm" title="Add selected" onClick={moveToChosen} disabled={availSel.length === 0}>
          &gt;
        </Button>
        <Button type="button" hierarchy="secondary" size="sm" title="Add all" onClick={moveAllToChosen} disabled={available.length === 0}>
          &gt;&gt;
        </Button>
        <Button type="button" hierarchy="secondary" size="sm" title="Remove selected" onClick={moveToAvailable} disabled={chosenSel.length === 0}>
          &lt;
        </Button>
        <Button type="button" hierarchy="secondary" size="sm" title="Remove all" onClick={moveAllToAvailable} disabled={chosen.length === 0}>
          &lt;&lt;
        </Button>
      </div>

      <RuleList
        title="Selected Items"
        rules={chosen}
        selected={chosenSel}
        emptyLabel="No rules assigned"
        onToggle={(id) => toggle(setChosenSel, id)}
      />
    </div>
  );
}

function HolidayFields({
  h,
  allRules,
  initialRuleIds,
}: {
  h?: HolidayWithRules;
  allRules: HolidayRule[];
  initialRuleIds: string[];
}) {
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[]>(initialRuleIds);
  const [bypass, setBypass] = useState<boolean>(h?.bypassAfterEligibility ?? false);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(200px,32%)),1fr))]">
        <Input label="Holiday Name" name="name" required defaultValue={h?.name ?? ""} placeholder="e.g. Christmas Day" />
        <Input label="Date" name="date" type="date" required defaultValue={h ? toDateInputValue(h.date) : ""} />
        <Input
          label="Observed On"
          name="observedDate"
          type="date"
          defaultValue={h?.observedDate ? toDateInputValue(h.observedDate) : ""}
          hint="Optional — when the day off is taken instead"
        />
      </div>

      <FormSection label="Options">
        {/* The kit's Checkbox carries no name — its real input is visually
            hidden and exists for the keyboard — so the value reaches the form
            through the hidden input beside it. */}
        <Checkbox
          checked={bypass}
          onChange={setBypass}
          label={
            <span style={{ textWrap: "pretty" }}>
              Enable the bypass of scheduled workday &ldquo;after&rdquo; eligibility
              <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                {" "}(Post Holiday bypass option also requires activation in Holiday Rule setup)
              </span>
            </span>
          }
        />
        <input type="hidden" name="bypassAfterEligibility" value={bypass ? "true" : "false"} />
      </FormSection>

      {allRules.length > 0 && (
        <FormSection label="Holiday Rules">
          <DualListbox allRules={allRules} selectedIds={selectedRuleIds} onChange={setSelectedRuleIds} />
          {/* Hidden input carries selected rule IDs to the form */}
          <input type="hidden" name="ruleIds" value={selectedRuleIds.join(",")} />
        </FormSection>
      )}
    </div>
  );
}

export function HolidaysManager({ holidays, holidayRules }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingHoliday, setEditingHoliday] = useState<HolidayWithRules | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [view, setView] = useState<View>("active");

  const currentYear = new Date().getFullYear();
  const [yearFilter, setYearFilter] = useState(String(currentYear));

  const years = [...new Set(holidays.map((h) => new Date(h.date).getUTCFullYear()))].sort(
    (a, b) => b - a
  );
  if (!years.includes(currentYear)) years.unshift(currentYear);

  const visible = holidays
    .filter((h) => (view === "all" ? true : view === "active" ? h.isActive : !h.isActive))
    .filter((h) => !yearFilter || new Date(h.date).getUTCFullYear() === Number(yearFilter));

  function openEdit(h: HolidayWithRules) {
    setEditingHoliday(h);
    setConfirmDeleteId(null);
    setError(null);
  }
  function closeEdit() {
    setEditingHoliday(null);
    setConfirmDeleteId(null);
    setError(null);
  }
  function openCreate() {
    setShowCreate(true);
    setError(null);
  }
  function closeCreate() {
    setShowCreate(false);
    setError(null);
  }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await createHoliday({
        name: fd.get("name") as string,
        date: fd.get("date") as string,
        observedDate: (fd.get("observedDate") as string) || null,
        bypassAfterEligibility: fd.get("bypassAfterEligibility") === "true",
        ruleIds: (fd.get("ruleIds") as string) || "",
      });
      if (!result.success) { setError(result.error); return; }
      closeCreate();
      router.refresh();
    });
  }

  function handleUpdate(h: HolidayWithRules, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await updateHoliday({
        holidayId: h.id,
        name: fd.get("name") as string,
        date: fd.get("date") as string,
        observedDate: (fd.get("observedDate") as string) || null,
        isActive: fd.get("isActive") === "true",
        bypassAfterEligibility: fd.get("bypassAfterEligibility") === "true",
        ruleIds: (fd.get("ruleIds") as string) || "",
      });
      if (!result.success) { setError(result.error); return; }
      closeEdit();
      router.refresh();
    });
  }

  function handleDelete(holidayId: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteHoliday({ holidayId });
      if (!result.success) { setError(result.error); setConfirmDeleteId(null); return; }
      setConfirmDeleteId(null);
      closeEdit();
      router.refresh();
    });
  }

  return (
    <div className="mt-4 flex flex-col gap-2.5">
      <Toolbar count={visible.length} countLabel="holiday">
        <SegmentedControl
          items={VIEWS}
          value={view}
          onChange={(v) => setView(v as View)}
          size="sm"
          ariaLabel="Which holidays to show"
        />
        <Select aria-label="Year" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
          <option value="">All years</option>
          {years.map((y) => (
            <option key={y} value={String(y)}>{y}</option>
          ))}
        </Select>
        <Button onClick={openCreate}>New Holiday</Button>
      </Toolbar>

      <Card padding={0}>
        {visible.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="h-8 w-8" />}
            title={yearFilter ? `No holidays in ${yearFilter}` : "No holidays"}
            body={
              yearFilter
                ? "Pick another year, or add the day and assign it to the rules that should credit it."
                : "A holiday is a date; what it pays comes from the holiday rules it is assigned to."
            }
            action={<Button size="sm" onClick={openCreate}>New Holiday</Button>}
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Holiday</TH>
                  <TH>Date</TH>
                  <TH>Observed</TH>
                  <TH numeric>Rules</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {visible.map((h) => {
                  const assignedCount = h.holidayRules?.length ?? 0;
                  return (
                    <TR key={h.id} onClick={() => openEdit(h)}>
                      <TD style={{ fontWeight: "var(--weight-medium)" }}>{h.name}</TD>
                      <TD className="tabular" style={{ color: "var(--text-secondary)" }}>
                        {formatUTCDate(h.date, "MMM d, yyyy")}
                      </TD>
                      <TD className="tabular" style={{ color: "var(--text-secondary)" }}>
                        {h.observedDate
                          ? formatUTCDate(h.observedDate, "MMM d")
                          : <span style={{ color: "var(--text-tertiary)" }}>—</span>}
                      </TD>
                      <TD numeric style={{ color: assignedCount === 0 ? "var(--text-warning)" : "var(--text-secondary)" }}>
                        {/* Zero is the one worth seeing: a holiday no rule picks
                            up is a day nobody gets paid for. */}
                        {assignedCount}
                      </TD>
                      <TD>
                        {h.isActive ? (
                          <Badge tone={statusTone("ACTIVE")} size="sm" dot>Active</Badge>
                        ) : (
                          // statusTone would answer "warning"; a holiday that is
                          // switched off is not something to go and fix.
                          <Badge size="sm">Inactive</Badge>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <TableFooter
              shown={visible.length}
              total={holidays.length}
              label={holidays.length === 1 ? "holiday" : "holidays"}
            />
          </>
        )}
      </Card>

      {showCreate && (
        <Modal title="New Holiday" onClose={closeCreate}>
          {error && <div className="mb-4"><Banner tone="error" body={error} /></div>}
          <form onSubmit={handleCreate}>
            <HolidayFields allRules={holidayRules} initialRuleIds={[]} />
            <div className="mt-5 flex gap-2 pt-4" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
              <Button type="submit" disabled={isPending}>{isPending ? "Creating…" : "Create"}</Button>
              <Button type="button" hierarchy="secondary" onClick={closeCreate}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}

      {editingHoliday && (
        <Modal title={`Edit: ${editingHoliday.name}`} onClose={closeEdit}>
          {error && <div className="mb-4"><Banner tone="error" body={error} /></div>}
          <form onSubmit={(e) => handleUpdate(editingHoliday, e)}>
            <HolidayFields
              h={editingHoliday}
              allRules={holidayRules}
              initialRuleIds={(editingHoliday.holidayRules ?? []).map((r) => r.holidayRuleId)}
            />
            <div className="mt-3 max-w-[200px]">
              <SelectField label="Status" name="isActive" defaultValue={editingHoliday.isActive ? "true" : "false"}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </SelectField>
            </div>
            <div
              className="mt-5 flex flex-wrap items-center justify-between gap-3 pt-4"
              style={{ borderTop: "1px solid var(--stroke-divider)" }}
            >
              <div className="flex gap-2">
                <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Save changes"}</Button>
                <Button type="button" hierarchy="secondary" onClick={closeEdit}>Cancel</Button>
              </div>
              {confirmDeleteId === editingHoliday.id ? (
                <div className="flex items-center gap-2">
                  <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>Are you sure?</span>
                  <Button type="button" tone="error" size="sm" onClick={() => handleDelete(editingHoliday.id)} disabled={isPending}>
                    {isPending ? "Deleting…" : "Yes, delete"}
                  </Button>
                  <Button type="button" hierarchy="secondary" size="sm" onClick={() => setConfirmDeleteId(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button type="button" hierarchy="link" tone="error" size="sm" onClick={() => setConfirmDeleteId(editingHoliday.id)}>
                  Delete holiday
                </Button>
              )}
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
