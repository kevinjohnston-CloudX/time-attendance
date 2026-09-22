"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Layers, X } from "lucide-react";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { createPayCategory, updatePayCategory, deletePayCategory } from "@/actions/pay-category.actions";
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
 * Pay categories, on the design's list template.
 *
 * <p>A category is the number payroll classifies somebody by, and what it
 * carries is the set of PTO policies that come with it — so that set is the
 * column, not a count. Two categories that both say "2 policies" are the
 * question this screen exists to answer.
 */

type PolicyRule = { leaveTypeId: string; leaveType: { id: string; name: string } };
type PolicyOption = { id: string; name: string; rules: PolicyRule[] };
type LeaveTypeOption = { id: string; name: string };

type CategoryWithPolicies = {
  id: string;
  number: number;
  description: string | null;
  isActive: boolean;
  limitLeaveTypes: boolean;
  ptoPolicies: Array<{ ptoPolicy: PolicyOption }>;
  availableLeaveTypes: Array<{ leaveTypeId: string }>;
};

interface Props {
  categories: CategoryWithPolicies[];
  ptoPolicies: PolicyOption[];
  leaveTypes: LeaveTypeOption[];
}

type View = "all" | "active" | "inactive";

const VIEWS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

/** Field grid from the design's doc template, at two columns. */
const FIELD_GRID = "grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(200px,48%)),1fr))]";

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

/** A section inside the form dialog, where a nested Card would be a panel on a panel. */
function FormSection({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <span className="wms-overline">{label}</span>
        {hint && <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function CategoryFields({ category, defaultNumber }: { category?: CategoryWithPolicies; defaultNumber?: number }) {
  return (
    <div className={FIELD_GRID}>
      <Input
        label="Category Number"
        name="number"
        type="number"
        min="1"
        max="9999"
        required
        defaultValue={category?.number ?? defaultNumber ?? ""}
        placeholder="e.g. 100"
      />
      <Input
        label="Description"
        name="description"
        maxLength={255}
        defaultValue={category?.description ?? ""}
        placeholder="e.g. Full-Time Hourly"
      />
    </div>
  );
}

/**
 * Which PTO policies come with this category.
 *
 * <p>Two policies covering the same leave type would both try to accrue it, so
 * the overlap is refused here with the leave types named. The server refuses
 * it too; this is so the person adding the policy learns which one already
 * covers Vacation rather than that something went wrong.
 */
function PolicyPicker({
  assigned,
  allPolicies,
  onChange,
}: {
  assigned: PolicyOption[];
  allPolicies: PolicyOption[];
  onChange: (policies: PolicyOption[]) => void;
}) {
  const [pickerId, setPickerId] = useState("");
  const [overlapError, setOverlapError] = useState<string | null>(null);

  const assignedIds = new Set(assigned.map((p) => p.id));
  const available = allPolicies.filter((p) => !assignedIds.has(p.id));

  function handleAdd() {
    if (!pickerId) return;
    const policy = allPolicies.find((p) => p.id === pickerId);
    if (!policy) return;

    const existingLeaveTypeIds = new Set(assigned.flatMap((p) => p.rules.map((r) => r.leaveTypeId)));
    const conflicts = policy.rules
      .filter((r) => existingLeaveTypeIds.has(r.leaveTypeId))
      .map((r) => r.leaveType.name);

    if (conflicts.length > 0) {
      setOverlapError(`Cannot add "${policy.name}" — leave type${conflicts.length > 1 ? "s" : ""} already covered by another policy: ${conflicts.join(", ")}`);
      return;
    }

    setOverlapError(null);
    setPickerId("");
    onChange([...assigned, policy]);
  }

  function handleRemove(id: string) {
    setOverlapError(null);
    onChange(assigned.filter((p) => p.id !== id));
  }

  return (
    <FormSection label="Leave Policies">
      {assigned.length === 0 ? (
        <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
          No policies assigned to this category.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {assigned.map((p) => (
            <div
              key={p.id}
              className="flex items-start justify-between gap-3 rounded-lg px-3 py-2"
              style={{ border: "1px solid var(--stroke-secondary)", background: "var(--surface-secondary)" }}
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span style={{ font: "var(--type-body1)", fontWeight: "var(--weight-medium)", color: "var(--text-primary)" }}>
                  {p.name}
                </span>
                {p.rules.length > 0 && (
                  <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                    {p.rules.map((r) => r.leaveType.name).join(", ")}
                  </span>
                )}
              </div>
              <Button type="button" hierarchy="link" tone="error" size="sm" onClick={() => handleRemove(p.id)}>
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}

      {available.length > 0 && (
        <div className="flex gap-2">
          <Select
            aria-label="Add a policy"
            value={pickerId}
            onChange={(e) => { setPickerId(e.target.value); setOverlapError(null); }}
            style={{ flex: 1 }}
          >
            <option value="">— Add a policy —</option>
            {available.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
          <Button type="button" hierarchy="secondary" onClick={handleAdd} disabled={!pickerId}>
            Add
          </Button>
        </div>
      )}

      {overlapError && <Banner tone="warning" body={overlapError} />}
    </FormSection>
  );
}

/** One half of the picker: a titled box whose rows move to the other side. */
function LeaveTypeBox({
  title,
  tone,
  items,
  onPick,
}: {
  title: string;
  tone: string;
  items: LeaveTypeOption[];
  onPick: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span style={{ font: "var(--type-button2)", color: tone }}>{title}</span>
      <div
        className="flex min-h-[120px] flex-col gap-1 rounded-lg p-2"
        style={{ border: "1px solid var(--stroke-secondary)", background: "var(--surface-secondary)" }}
      >
        {items.length === 0 && (
          <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>None</span>
        )}
        {items.map((lt) => (
          <button
            key={lt.id}
            type="button"
            onClick={() => onPick(lt.id)}
            className="ta-hoverable w-full rounded px-2 py-1.5 text-left"
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              font: "var(--type-body1)",
              color: "var(--text-primary)",
            }}
          >
            {lt.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Which leave types this category may request.
 *
 * <p>Two boxes rather than a checklist: the question a payroll admin asks here
 * is "what can these people not book", and a list of ticks answers it only by
 * reading every row.
 */
function LeaveTypePicker({
  allLeaveTypes,
  initialAvailableIds,
  onChange,
}: {
  allLeaveTypes: LeaveTypeOption[];
  initialAvailableIds: string[] | null;
  onChange: (availableIds: string[]) => void;
}) {
  const [availableIds, setAvailableIds] = useState<Set<string>>(() => {
    // null = no existing config → default all available
    if (initialAvailableIds === null) return new Set(allLeaveTypes.map((lt) => lt.id));
    return new Set(initialAvailableIds);
  });

  function move(id: string, toAvailable: boolean) {
    setAvailableIds((prev) => {
      const next = new Set(prev);
      if (toAvailable) next.add(id); else next.delete(id);
      onChange([...next]);
      return next;
    });
  }

  const availableList   = allLeaveTypes.filter((lt) =>  availableIds.has(lt.id));
  const unavailableList = allLeaveTypes.filter((lt) => !availableIds.has(lt.id));

  return (
    <FormSection label="Available for Leave Request" hint="Click a leave type to move it between boxes.">
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(160px,48%)),1fr))]">
        <LeaveTypeBox title="Available" tone="var(--text-success)" items={availableList} onPick={(id) => move(id, false)} />
        <LeaveTypeBox title="Unavailable" tone="var(--text-tertiary)" items={unavailableList} onPick={(id) => move(id, true)} />
      </div>
    </FormSection>
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
        className="ta-modal max-h-[90vh] w-full max-w-xl overflow-y-auto"
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

export function PayCategoriesManager({ categories, ptoPolicies, leaveTypes }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingCat, setEditingCat] = useState<CategoryWithPolicies | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [view, setView] = useState<View>("active");

  const [createPolicies, setCreatePolicies] = useState<PolicyOption[]>([]);
  const [editPolicies,   setEditPolicies]   = useState<PolicyOption[]>([]);

  const [createLimitLeaveTypes, setCreateLimitLeaveTypes] = useState(false);
  const [editLimitLeaveTypes,   setEditLimitLeaveTypes]   = useState(false);

  const [createAvailableLeaveTypeIds, setCreateAvailableLeaveTypeIds] = useState<string[]>(() =>
    leaveTypes.map((lt) => lt.id)
  );
  const [editAvailableLeaveTypeIds, setEditAvailableLeaveTypeIds] = useState<string[]>([]);

  const visible = categories.filter((c) =>
    view === "all" ? true : view === "active" ? c.isActive : !c.isActive,
  );

  function openEdit(cat: CategoryWithPolicies) {
    setEditingCat(cat);
    setEditPolicies(cat.ptoPolicies.map((link) => link.ptoPolicy));
    setEditLimitLeaveTypes(cat.limitLeaveTypes);
    const ids = cat.availableLeaveTypes.length === 0
      ? leaveTypes.map((lt) => lt.id)
      : cat.availableLeaveTypes.map((r) => r.leaveTypeId);
    setEditAvailableLeaveTypeIds(ids);
    setConfirmDeleteId(null);
    setError(null);
  }
  function closeEdit() { setEditingCat(null); setConfirmDeleteId(null); setError(null); }
  function openCreate() {
    setShowCreate(true);
    setCreatePolicies([]);
    setCreateLimitLeaveTypes(false);
    setCreateAvailableLeaveTypeIds(leaveTypes.map((lt) => lt.id));
    setError(null);
  }
  function closeCreate() { setShowCreate(false); setError(null); }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await createPayCategory({
        number:                fd.get("number"),
        description:           (fd.get("description") as string) || undefined,
        ptoPolicyIds:          createPolicies.map((p) => p.id),
        limitLeaveTypes:       createLimitLeaveTypes,
        availableLeaveTypeIds: createLimitLeaveTypes ? createAvailableLeaveTypeIds : [],
      });
      if (!result.success) { setError(result.error); return; }
      closeCreate();
      router.refresh();
    });
  }

  function handleUpdate(cat: CategoryWithPolicies, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await updatePayCategory({
        id:                    cat.id,
        number:                fd.get("number"),
        description:           (fd.get("description") as string) || undefined,
        isActive:              fd.get("isActive") === "true",
        ptoPolicyIds:          editPolicies.map((p) => p.id),
        limitLeaveTypes:       editLimitLeaveTypes,
        availableLeaveTypeIds: editLimitLeaveTypes ? editAvailableLeaveTypeIds : [],
      });
      if (!result.success) { setError(result.error); return; }
      closeEdit();
      router.refresh();
    });
  }

  function handleDelete(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await deletePayCategory({ id });
      if (!result.success) { setError(result.error); setConfirmDeleteId(null); return; }
      setConfirmDeleteId(null);
      closeEdit();
      router.refresh();
    });
  }

  return (
    <div className="mt-4 flex flex-col gap-2.5">
      <Toolbar count={visible.length} countLabel="pay category">
        <SegmentedControl
          items={VIEWS}
          value={view}
          onChange={(v) => setView(v as View)}
          size="sm"
          ariaLabel="Which pay categories to show"
        />
        <Button onClick={openCreate}>New Pay Category</Button>
      </Toolbar>

      <Card padding={0}>
        {visible.length === 0 ? (
          <EmptyState
            icon={<Layers className="h-8 w-8" />}
            title={view === "active" ? "No active pay categories" : view === "inactive" ? "No retired pay categories" : "No pay categories"}
            body="A pay category classifies an employee for payroll and carries the PTO policies that come with it."
            action={<Button size="sm" onClick={openCreate}>New Pay Category</Button>}
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH numeric style={{ width: 96 }}>Category</TH>
                  <TH>Description</TH>
                  <TH>Leave Policies</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {visible.map((cat) => (
                  <TR key={cat.id} onClick={() => openEdit(cat)}>
                    <TD numeric style={{ fontWeight: "var(--weight-semibold)" }}>{cat.number}</TD>
                    <TD style={{ fontWeight: "var(--weight-medium)" }}>
                      {cat.description || <span style={{ color: "var(--text-tertiary)", fontWeight: "var(--weight-regular)" }}>—</span>}
                    </TD>
                    <TD style={{ color: "var(--text-secondary)" }}>
                      {cat.ptoPolicies.length === 0
                        ? <span style={{ color: "var(--text-tertiary)" }}>None</span>
                        : cat.ptoPolicies.map((link) => link.ptoPolicy.name).join(" · ")}
                    </TD>
                    <TD>
                      {cat.isActive ? (
                        <Badge tone={statusTone("ACTIVE")} size="sm" dot>Active</Badge>
                      ) : (
                        // statusTone would answer "warning"; a retired category
                        // is not something to go and fix.
                        <Badge size="sm">Inactive</Badge>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <TableFooter
              shown={visible.length}
              total={categories.length}
              label={categories.length === 1 ? "pay category" : "pay categories"}
            />
          </>
        )}
      </Card>

      {showCreate && (
        <Modal title="New Pay Category" onClose={closeCreate}>
          <form onSubmit={handleCreate} className="flex flex-col gap-4">
            <CategoryFields defaultNumber={Math.max(0, ...categories.map((c) => c.number)) + 1} />
            <PolicyPicker assigned={createPolicies} allPolicies={ptoPolicies} onChange={setCreatePolicies} />
            {leaveTypes.length > 0 && (
              <div className="flex flex-col gap-3">
                <Checkbox
                  checked={createLimitLeaveTypes}
                  onChange={setCreateLimitLeaveTypes}
                  label="Limit leave request options"
                />
                {createLimitLeaveTypes && (
                  <LeaveTypePicker
                    allLeaveTypes={leaveTypes}
                    initialAvailableIds={null}
                    onChange={setCreateAvailableLeaveTypeIds}
                  />
                )}
              </div>
            )}
            {error && <Banner tone="error" body={error} />}
            <div className="flex gap-2 pt-4" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
              <Button type="submit" disabled={isPending}>{isPending ? "Creating…" : "Create"}</Button>
              <Button type="button" hierarchy="secondary" onClick={closeCreate}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}

      {editingCat && (
        <Modal title={`Edit: ${editingCat.number}${editingCat.description ? ` — ${editingCat.description}` : ""}`} onClose={closeEdit}>
          <form onSubmit={(e) => handleUpdate(editingCat, e)} className="flex flex-col gap-4">
            <CategoryFields category={editingCat} />
            <div className={FIELD_GRID}>
              <SelectField label="Status" name="isActive" defaultValue={editingCat.isActive ? "true" : "false"}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </SelectField>
            </div>
            <PolicyPicker assigned={editPolicies} allPolicies={ptoPolicies} onChange={setEditPolicies} />
            {leaveTypes.length > 0 && (
              <div className="flex flex-col gap-3">
                <Checkbox
                  checked={editLimitLeaveTypes}
                  onChange={setEditLimitLeaveTypes}
                  label="Limit leave request options"
                />
                {editLimitLeaveTypes && (
                  <LeaveTypePicker
                    key={editingCat.id}
                    allLeaveTypes={leaveTypes}
                    initialAvailableIds={
                      editingCat.availableLeaveTypes.length === 0
                        ? null
                        : editingCat.availableLeaveTypes.map((r) => r.leaveTypeId)
                    }
                    onChange={setEditAvailableLeaveTypeIds}
                  />
                )}
              </div>
            )}
            {error && <Banner tone="error" body={error} />}
            <div
              className="flex flex-wrap items-center justify-between gap-3 pt-4"
              style={{ borderTop: "1px solid var(--stroke-divider)" }}
            >
              <div className="flex gap-2">
                <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Save changes"}</Button>
                <Button type="button" hierarchy="secondary" onClick={closeEdit}>Cancel</Button>
              </div>
              {confirmDeleteId === editingCat.id ? (
                <div className="flex items-center gap-2">
                  <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>Are you sure?</span>
                  <Button type="button" tone="error" size="sm" onClick={() => handleDelete(editingCat.id)} disabled={isPending}>
                    {isPending ? "Deleting…" : "Yes, delete"}
                  </Button>
                  <Button type="button" hierarchy="secondary" size="sm" onClick={() => setConfirmDeleteId(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button type="button" hierarchy="link" tone="error" size="sm" onClick={() => setConfirmDeleteId(editingCat.id)}>
                  Delete category
                </Button>
              )}
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
