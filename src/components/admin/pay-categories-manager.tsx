"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/components/layout/navigation-progress";
import { Layers, Plus } from "lucide-react";
import { createPayCategory, updatePayCategory, deletePayCategory } from "@/actions/pay-category.actions";
import { Badge, Banner, Button, EmptyState, Input, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import {
  AreaPanel,
  ChoiceField,
  DeleteAction,
  Muted,
  PickList,
  SetupDialog,
  StatusBadge,
  StatusField,
  countLine,
  matches,
  saveError,
  useStatusView,
  useOpenFromLink,
} from "./setup/setup-ui";

/**
 * Pay categories: the number payroll classifies somebody by, the leave
 * policies that come with it, and which leave types its people may request.
 *
 * <p>Two policies may not cover the same leave type in one category. The
 * window says which ones clash as soon as they are both picked, and the
 * server checks again. A category anyone is still in cannot be deleted:
 * deleting it used to clear it from every one of them without a word.
 */

export type PolicyRule = { leaveTypeId: string; leaveType: { id: string; name: string } };
export type PolicyOption = { id: string; name: string; rules: PolicyRule[] };
export type LeaveTypeOption = { id: string; name: string };

type Category = {
  id: string;
  number: number;
  description: string | null;
  isActive: boolean;
  limitLeaveTypes: boolean;
  ptoPolicies: Array<{ ptoPolicy: PolicyOption }>;
  availableLeaveTypes: Array<{ leaveTypeId: string }>;
  _count?: { employees: number };
};

/** Policy names shown in a row before the rest fold into a count. */
const POLICIES_SHOWN = 3;

/** Leave types a policy covers, once each (a policy has a rule per tier). */
function coveredBy(p: PolicyOption): Map<string, string> {
  return new Map(p.rules.map((r) => [r.leaveTypeId, r.leaveType.name]));
}

/** The first leave type two picked policies both cover, in words, or null. */
function clash(picked: PolicyOption[]): string | null {
  const seen = new Map<string, string>();
  for (const p of picked) {
    for (const [id, name] of coveredBy(p)) {
      if (seen.has(id)) return `${name} is covered by both ${seen.get(id)} and ${p.name}. Keep only one of them.`;
    }
    for (const [id] of coveredBy(p)) seen.set(id, p.name);
  }
  return null;
}

export function PayCategoriesManager({
  categories,
  ptoPolicies,
  leaveTypes,
}: {
  categories: Category[];
  ptoPolicies: PolicyOption[];
  leaveTypes: LeaveTypeOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const [query, setQuery] = useState("");
  const { view, setView, counts, kept } = useStatusView(categories);
  const shown = kept.filter((c) => matches(query, c.number, c.description, ...c.ptoPolicies.map((p) => p.ptoPolicy.name)));
  const nextNumber = categories.length ? Math.max(...categories.map((c) => c.number)) + 1 : 1;

  function open(c: Category | "new") {
    setEditing(c);
    setError(null);
  }
  // A link from elsewhere (an employee record, a classic address) opens its record.
  useOpenFromLink(categories, open);
  function close() {
    setEditing(null);
    setError(null);
  }

  function save(form: FormData, policyIds: string[], limit: boolean, leaveTypeIds: string[]) {
    const fields = {
      number: String(form.get("number") ?? ""),
      description: String(form.get("description") ?? "").trim() || undefined,
      ptoPolicyIds: policyIds,
      limitLeaveTypes: limit,
      availableLeaveTypeIds: limit ? leaveTypeIds : [],
    };
    setError(null);
    startTransition(async () => {
      const result =
        editing === "new"
          ? await createPayCategory(fields)
          : await updatePayCategory({ ...fields, id: (editing as Category).id, isActive: form.get("isActive") === "true" });
      if (!result.success) return setError(saveError(result.error));
      close();
      router.refresh();
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await deletePayCategory({ id });
      if (!result.success) return setError(saveError(result.error));
      close();
      router.refresh();
    });
  }

  const addButton = (
    <Button onClick={() => open("new")} leadingIcon={<Plus className="h-4 w-4" />}>
      Add pay category
    </Button>
  );

  return (
    <>
      <AreaPanel
        title="Pay categories"
        hint="The number payroll classifies people by, with the leave policies that come with it."
        action={addButton}
        status={{ view, onChange: setView, counts }}
        search={categories.length ? { value: query, onChange: setQuery, placeholder: "Number, name or policy" } : undefined}
        count={countLine(shown.length, categories.length, "pay category", "pay categories")}
      >
        {categories.length === 0 ? (
          <EmptyState
            icon={<Layers className="h-8 w-8" />}
            title="No pay categories yet"
            body="Add the first one, then pick the leave policies that come with it."
            action={addButton}
          />
        ) : shown.length === 0 ? (
          <EmptyState icon={<Layers className="h-8 w-8" />} title="No pay categories match" body="Nothing matches that search or status." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH numeric>No.</TH>
                <TH>Pay category</TH>
                <TH>Leave policies</TH>
                <TH>Can request</TH>
                <TH numeric>Employees</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {shown.map((c) => {
                const names = c.ptoPolicies.map((p) => p.ptoPolicy.name);
                const people = c._count?.employees ?? 0;
                return (
                  <TR key={c.id} onClick={() => open(c)}>
                    <TD numeric style={{ fontWeight: "var(--weight-semibold)" }}>
                      {c.number}
                    </TD>
                    <TD style={{ fontWeight: "var(--weight-medium)" }}>{c.description || <Muted>No name</Muted>}</TD>
                    <TD>
                      {names.length === 0 ? (
                        <Muted />
                      ) : (
                        <span className="flex flex-wrap items-center gap-1.5" title={names.join(", ")}>
                          {names.slice(0, POLICIES_SHOWN).map((n) => (
                            <Badge key={n} size="sm">
                              {n}
                            </Badge>
                          ))}
                          {names.length > POLICIES_SHOWN && <Muted>and {names.length - POLICIES_SHOWN} more</Muted>}
                        </span>
                      )}
                    </TD>
                    <TD style={{ color: "var(--text-secondary)" }}>
                      {c.limitLeaveTypes ? `${c.availableLeaveTypes.length} of ${leaveTypes.length} leave types` : "Every leave type"}
                    </TD>
                    <TD numeric style={{ color: people ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                      {people.toLocaleString()}
                    </TD>
                    <TD>
                      <StatusBadge active={c.isActive} />
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </AreaPanel>

      {editing && (
        <CategoryDialog
          category={editing === "new" ? null : editing}
          nextNumber={nextNumber}
          policies={ptoPolicies}
          leaveTypes={leaveTypes}
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

function CategoryDialog({
  category: c,
  nextNumber,
  policies,
  leaveTypes,
  pending,
  error,
  onSubmit,
  onDelete,
  onClose,
}: {
  category: Category | null;
  nextNumber: number;
  policies: PolicyOption[];
  leaveTypes: LeaveTypeOption[];
  pending: boolean;
  error: string | null;
  onSubmit: (form: FormData, policyIds: string[], limit: boolean, leaveTypeIds: string[]) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [policyIds, setPolicyIds] = useState<string[]>(() => c?.ptoPolicies.map((p) => p.ptoPolicy.id) ?? []);
  const [limit, setLimit] = useState(c?.limitLeaveTypes ?? false);
  // Nothing stored means every type was on offer, so the list starts full.
  const [leaveTypeIds, setLeaveTypeIds] = useState<string[]>(() =>
    c?.limitLeaveTypes && c.availableLeaveTypes.length ? c.availableLeaveTypes.map((a) => a.leaveTypeId) : leaveTypes.map((l) => l.id),
  );
  const byId = new Map(policies.map((p) => [p.id, p]));
  const conflict = clash(policyIds.map((id) => byId.get(id)).filter((p): p is PolicyOption => !!p));
  const people = c?._count?.employees ?? 0;

  return (
    <SetupDialog
      title={c ? `${c.number} ${c.description ?? ""}`.trim() : "Add pay category"}
      subtitle={c ? `${people.toLocaleString()} ${people === 1 ? "employee" : "employees"} in this category` : undefined}
      submitLabel={c ? "Save changes" : "Add pay category"}
      pending={pending}
      error={error}
      onSubmit={(form) => {
        if (!conflict) onSubmit(form, policyIds, limit, leaveTypeIds);
      }}
      onClose={onClose}
      width={640}
      danger={
        c ? (
          people > 0 ? (
            <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
              In use, so it cannot be deleted. Set it to inactive instead.
            </span>
          ) : (
            <DeleteAction
              label="Delete pay category"
              question="Delete this pay category for good?"
              pending={pending}
              onDelete={() => onDelete(c.id)}
            />
          )
        ) : undefined
      }
    >
      <div className="grid gap-x-4 gap-y-3.5 [grid-template-columns:120px_minmax(0,1fr)]">
        <Input
          label="Number"
          name="number"
          type="number"
          min={1}
          max={9999}
          required
          defaultValue={String(c?.number ?? nextNumber)}
        />
        <Input label="Name" name="description" maxLength={255} defaultValue={c?.description ?? ""} placeholder="Full time hourly" />
      </div>

      {policies.length > 0 ? (
        <div className="flex flex-col gap-2">
          <PickList
            label="Leave policies"
            items={policies.map((p) => ({
              id: p.id,
              label: p.name,
              note: [...coveredBy(p).values()].join(", ") || undefined,
            }))}
            selected={policyIds}
            onChange={setPolicyIds}
            searchPlaceholder="Find a policy"
            invalid={!!conflict}
            hint={conflict ?? "People in this category earn time off under these policies."}
          />
        </div>
      ) : (
        <Banner tone="info" title="No leave policies yet" body="Create them in Rules Setup, then pick them here." />
      )}

      {leaveTypes.length > 0 && (
        <div className="flex flex-col gap-3">
          <ChoiceField
            label="Leave people can request"
            name="limitLeaveTypes"
            defaultValue={limit ? "some" : "all"}
            onChange={(v) => setLimit(v === "some")}
            options={[
              { value: "all", label: "Every leave type" },
              { value: "some", label: "Only some" },
            ]}
          />
          {limit && (
            <PickList
              label="Leave types on offer"
              items={leaveTypes.map((l) => ({ id: l.id, label: l.name }))}
              selected={leaveTypeIds}
              onChange={setLeaveTypeIds}
              searchPlaceholder="Find a leave type"
              hint="Only these show when people in this category request time off."
            />
          )}
        </div>
      )}

      {c && <StatusField defaultActive={c.isActive} />}
    </SetupDialog>
  );
}
