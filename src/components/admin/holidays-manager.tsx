"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/components/layout/navigation-progress";
import { format, parseISO } from "date-fns";
import { CalendarDays, Plus } from "lucide-react";
import { createHoliday, updateHoliday, deleteHoliday } from "@/actions/holiday.actions";
import { Badge, Button, Checkbox, EmptyState, FilterSelectChip, Input, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import {
  AreaPanel,
  DeleteAction,
  FIELD_GRID,
  Muted,
  PickList,
  SetupDialog,
  StatusBadge,
  StatusField,
  countLine,
  matches,
  saveError,
  useStatusView,
} from "./setup/setup-ui";

/**
 * Holidays: the dates the company marks, and which holiday rules pay them.
 *
 * <p>What a holiday pays, and who gets it, lives on the holiday rules in
 * Rules Setup; a holiday is only the date. So a holiday no rule picks up
 * pays nobody, and its row says so.
 *
 * <p>The year opens on this one. Dates are stored as UTC midnight and read
 * in UTC, so the day never shifts with the viewer's time zone.
 */

interface HolidayRule {
  id: string;
  name: string;
  number?: number | null;
}

interface HolidayWithRules {
  id: string;
  name: string;
  date: Date | string;
  observedDate?: Date | string | null;
  isActive: boolean;
  bypassAfterEligibility: boolean;
  holidayRules?: { holidayRuleId: string }[];
}

const asDate = (d: Date | string) => (typeof d === "string" ? parseISO(d) : d);
/** YYYY-MM-DD from the stored UTC midnight. */
const dayKey = (d: Date | string) => asDate(d).toISOString().slice(0, 10);
/** The stored day as a local date, so date-fns formats the right day. */
const localDay = (d: Date | string) => {
  const u = asDate(d);
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
};

/** "Today", "Tomorrow", "In 12 days", for the next two months only. */
function whenLine(d: Date | string): string | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((localDay(d).getTime() - today.getTime()) / 86_400_000);
  if (days < 0 || days > 60) return null;
  return days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`;
}

export function HolidaysManager({ holidays, holidayRules }: { holidays: HolidayWithRules[]; holidayRules: HolidayRule[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<HolidayWithRules | "new" | null>(null);
  const [query, setQuery] = useState("");

  const thisYear = new Date().getFullYear();
  const years = [...new Set([thisYear, ...holidays.map((h) => asDate(h.date).getUTCFullYear())])].sort((a, b) => b - a);
  const [year, setYear] = useState(String(thisYear));

  const inYear = holidays.filter((h) => !year || asDate(h.date).getUTCFullYear() === Number(year));
  const { view, setView, counts, kept } = useStatusView(inYear);
  const shown = kept.filter((h) => matches(query, h.name));
  const ruleName = new Map(holidayRules.map((r) => [r.id, r.name]));

  function open(h: HolidayWithRules | "new") {
    setEditing(h);
    setError(null);
  }
  function close() {
    setEditing(null);
    setError(null);
  }

  function save(form: FormData) {
    const fields = {
      name: String(form.get("name") ?? "").trim(),
      date: String(form.get("date") ?? ""),
      observedDate: String(form.get("observedDate") ?? "") || null,
      bypassAfterEligibility: form.get("bypassAfterEligibility") === "true",
      ruleIds: String(form.get("ruleIds") ?? ""),
    };
    setError(null);
    startTransition(async () => {
      const result =
        editing === "new"
          ? await createHoliday(fields)
          : await updateHoliday({ ...fields, holidayId: (editing as HolidayWithRules).id, isActive: form.get("isActive") === "true" });
      if (!result.success) return setError(saveError(result.error));
      close();
      router.refresh();
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteHoliday({ holidayId: id });
      if (!result.success) return setError(saveError(result.error));
      close();
      router.refresh();
    });
  }

  const addButton = (
    <Button onClick={() => open("new")} leadingIcon={<Plus className="h-4 w-4" />}>
      Add holiday
    </Button>
  );

  return (
    <>
      <AreaPanel
        title="Holidays"
        hint="The dates the company marks. What each one pays comes from the holiday rules it is assigned to."
        action={addButton}
        status={{ view, onChange: setView, counts }}
        search={holidays.length ? { value: query, onChange: setQuery, placeholder: "Holiday name" } : undefined}
        filters={
          <FilterSelectChip
            label="Year"
            allLabel="Every year"
            value={year}
            options={years.map((y) => ({ id: String(y), name: String(y) }))}
            onChange={setYear}
          />
        }
        count={countLine(shown.length, inYear.length, "holiday", "holidays") + (year ? ` in ${year}` : "")}
      >
        {holidays.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="h-8 w-8" />}
            title="No holidays yet"
            body="Add a date, then pick the holiday rules that should pay it."
            action={addButton}
          />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="h-8 w-8" />}
            title={year && inYear.length === 0 ? `No holidays in ${year}` : "No holidays match"}
            body={year && inYear.length === 0 ? "Pick another year, or add the dates for this one." : "Nothing matches that search or status."}
            action={year && inYear.length === 0 ? addButton : undefined}
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Holiday</TH>
                <TH>Date</TH>
                <TH>Observed</TH>
                <TH>Holiday rules</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {shown.map((h) => {
                const rules = (h.holidayRules ?? []).map((r) => ruleName.get(r.holidayRuleId)).filter(Boolean) as string[];
                const when = whenLine(h.date);
                return (
                  <TR key={h.id} onClick={() => open(h)}>
                    <TD style={{ fontWeight: "var(--weight-medium)" }}>{h.name}</TD>
                    <TD>
                      <span className="tabular">{format(localDay(h.date), "EEE, MMM d, yyyy")}</span>
                      {when && (
                        <span className="ml-2" style={{ font: "var(--type-caption1)", color: "var(--text-accent)" }}>
                          {when}
                        </span>
                      )}
                    </TD>
                    <TD className="tabular" style={{ color: "var(--text-secondary)" }}>
                      {h.observedDate ? format(localDay(h.observedDate), "EEE, MMM d") : <Muted>Same day</Muted>}
                    </TD>
                    <TD>
                      {(h.holidayRules?.length ?? 0) === 0 ? (
                        <span title="No holiday rule pays this date.">
                          <Badge tone="warning" size="sm">
                            No rules
                          </Badge>
                        </span>
                      ) : (
                        <span title={rules.join(", ")} style={{ color: "var(--text-secondary)" }}>
                          {h.holidayRules!.length} {h.holidayRules!.length === 1 ? "rule" : "rules"}
                        </span>
                      )}
                    </TD>
                    <TD>
                      <StatusBadge active={h.isActive} />
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </AreaPanel>

      {editing && (
        <HolidayDialog
          holiday={editing === "new" ? null : editing}
          rules={holidayRules}
          pending={isPending}
          error={error}
          onSubmit={save}
          onDelete={remove}
          onClose={close}
        />
      )}
    </>
  );
}

function HolidayDialog({
  holiday,
  rules,
  pending,
  error,
  onSubmit,
  onDelete,
  onClose,
}: {
  holiday: HolidayWithRules | null;
  rules: HolidayRule[];
  pending: boolean;
  error: string | null;
  onSubmit: (form: FormData) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [ruleIds, setRuleIds] = useState<string[]>(() => holiday?.holidayRules?.map((r) => r.holidayRuleId) ?? []);
  const [bypass, setBypass] = useState(holiday?.bypassAfterEligibility ?? false);

  return (
    <SetupDialog
      title={holiday ? holiday.name : "Add holiday"}
      subtitle={holiday ? format(localDay(holiday.date), "EEEE, MMMM d, yyyy") : undefined}
      submitLabel={holiday ? "Save changes" : "Add holiday"}
      pending={pending}
      error={error}
      onSubmit={onSubmit}
      onClose={onClose}
      width={600}
      danger={
        holiday ? (
          <DeleteAction
            label="Delete holiday"
            question="Delete this holiday for good?"
            pending={pending}
            onDelete={() => onDelete(holiday.id)}
          />
        ) : undefined
      }
    >
      <Input label="Name" name="name" required defaultValue={holiday?.name ?? ""} placeholder="Christmas Day" />
      <div className={FIELD_GRID}>
        <Input label="Date" name="date" type="date" required defaultValue={holiday ? dayKey(holiday.date) : ""} />
        <Input
          label="Observed on"
          name="observedDate"
          type="date"
          defaultValue={holiday?.observedDate ? dayKey(holiday.observedDate) : ""}
          hint="Optional. The day off is taken on this date instead."
        />
      </div>

      {rules.length > 0 ? (
        <PickList
          label="Holiday rules that pay it"
          items={rules.map((r) => ({ id: r.id, label: r.name, note: r.number ? `Rule ${r.number}` : undefined }))}
          selected={ruleIds}
          onChange={setRuleIds}
          name="ruleIds"
          searchPlaceholder="Find a rule"
          hint="Each rule decides who is paid for the day and how much."
        />
      ) : (
        <input type="hidden" name="ruleIds" value="" />
      )}

      <div className="flex flex-col gap-1">
        {/* The kit's Checkbox carries no name, so the value goes through the hidden input. */}
        <Checkbox
          checked={bypass}
          onChange={setBypass}
          label="Skip the scheduled workday after requirement for this holiday"
        />
        <span className="pl-6" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)", textWrap: "pretty" }}>
          Only takes effect on holiday rules that allow this bypass.
        </span>
        <input type="hidden" name="bypassAfterEligibility" value={bypass ? "true" : "false"} />
      </div>

      {holiday && <StatusField defaultActive={holiday.isActive} />}
    </SetupDialog>
  );
}
