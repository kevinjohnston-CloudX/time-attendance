"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Palmtree, X } from "lucide-react";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { createLeaveType, updateLeaveType } from "@/actions/admin.actions";
import { formatMinutes } from "@/lib/utils/duration";
import type { LeaveType } from "@prisma/client";
import {
  Badge,
  Banner,
  Button,
  Card,
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
 * Leave types, on the design's list template, with the design's three views.
 *
 * <p>All / Active / Inactive filter rows that are already on the page — this
 * screen is handed every leave type at once, and a view that re-queried would
 * be a second source of truth for which types exist.
 *
 * <p>The design's Unit column is left out: every leave type here is kept in
 * minutes and shown in hours, so a Unit column would read "Hours" all the way
 * down. Accrual Policy is left out too — a policy points at a leave type, not
 * the other way round, and the policies are not loaded on this screen.
 */

interface PayCodeOption { id: string; code: number; label: string }
interface Props { leaveTypes: LeaveType[]; payCodes: PayCodeOption[] }

const CATEGORIES = ["PTO","SICK","HOLIDAY","FMLA","BEREAVEMENT","JURY_DUTY","MILITARY","UNPAID"] as const;

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
  hint,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex w-full flex-col gap-1.5">
      <span className="wms-label">{label}</span>
      <Select {...rest}>{children}</Select>
      {hint && <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>{hint}</span>}
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

/**
 * Hours and minutes as two controls.
 *
 * <p>The stored value is minutes, and the minute half is a select of quarter
 * hours rather than a free number: a balance cap typed as 7:63 is a cap
 * nobody meant, and it would sit in the database looking like 8:03.
 */
function HoursInput({
  name,
  label,
  defaultMinutes,
  hint,
}: {
  name: string;
  label: string;
  defaultMinutes?: number | null;
  hint?: string;
}) {
  const defaultHours = defaultMinutes != null ? String(Math.floor(defaultMinutes / 60)) : "";
  const defaultMins  = defaultMinutes != null ? String(defaultMinutes % 60) : "0";
  return (
    <div className="flex w-full flex-col gap-1.5">
      <span className="wms-label">{label}</span>
      <div className="flex items-center gap-2">
        <div className="w-20 flex-none">
          <Input name={`${name}_hours`} type="number" min={0} defaultValue={defaultHours} placeholder="0" aria-label={`${label} — hours`} />
        </div>
        <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>h</span>
        <Select name={`${name}_mins`} defaultValue={defaultMins} aria-label={`${label} — minutes`}>
          <option value="0">0 min</option>
          <option value="15">15 min</option>
          <option value="30">30 min</option>
          <option value="45">45 min</option>
        </Select>
      </div>
      {hint && <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>{hint}</span>}
    </div>
  );
}

function LeaveTypeFields({ lt, payCodes }: { lt?: LeaveType & { payCodeId?: string | null }; payCodes: PayCodeOption[] }) {
  return (
    <div className={FIELD_GRID}>
      <Input label="Name" name="name" defaultValue={lt?.name} required placeholder="e.g. Paid Time Off" />
      <SelectField label="Category" name="category" defaultValue={lt?.category} required>
        <option value="">— Choose —</option>
        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </SelectField>
      <SelectField label="Paid / Unpaid" name="isPaid" defaultValue={lt ? (lt.isPaid ? "true" : "false") : "true"}>
        <option value="true">Paid</option>
        <option value="false">Unpaid</option>
      </SelectField>
      <HoursInput name="maxBalance" label="Max balance" defaultMinutes={lt?.maxBalanceMinutes} hint="Optional — leave blank for no cap" />
      <SelectField label="Approval" name="requiresApproval" defaultValue={lt ? (lt.requiresApproval ? "true" : "false") : "true"}>
        <option value="true">Requires supervisor approval</option>
        <option value="false">No approval needed</option>
      </SelectField>
      <Input
        label="API Code"
        name="externalCode"
        type="number"
        min={1}
        step={1}
        defaultValue={lt?.externalCode ?? ""}
        placeholder="Auto"
        hint="Optional — assigned for you when blank"
      />
      <SelectField label="Accrual Tracking" name="accrualTracked" defaultValue={lt ? (lt.accrualTracked ? "true" : "false") : "true"}>
        <option value="true">Accrual tracked — balance managed by system</option>
        <option value="false">Not tracked — informational only</option>
      </SelectField>
      {payCodes.length > 0 && (
        <SelectField label="Pay Code" name="payCodeId" defaultValue={lt?.payCodeId ?? ""} hint="Used for the timecard row this leave posts">
          <option value="">— None —</option>
          {payCodes.map((pc) => (
            <option key={pc.id} value={pc.id}>{pc.code}[{pc.label}]</option>
          ))}
        </SelectField>
      )}
    </div>
  );
}

export function LeaveTypesManager({ leaveTypes, payCodes }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingLt, setEditingLt] = useState<LeaveType | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [view, setView] = useState<View>("all");

  const visible = leaveTypes.filter((lt) =>
    view === "all" ? true : view === "active" ? lt.isActive : !lt.isActive,
  );

  function openEdit(lt: LeaveType) { setEditingLt(lt); setError(null); }
  function closeEdit() { setEditingLt(null); setError(null); }
  function openCreate() { setShowCreate(true); setError(null); }
  function closeCreate() { setShowCreate(false); setError(null); }

  function toMins(fd: FormData, name: string): number {
    return (Number(fd.get(`${name}_hours`) ?? 0) * 60) + Number(fd.get(`${name}_mins`) ?? 0);
  }

  function parseForm(fd: FormData) {
    const maxH = fd.get("maxBalance_hours");
    const hasMax = maxH !== "" && maxH !== null;
    const codeRaw = fd.get("externalCode");
    const externalCode = codeRaw !== "" && codeRaw !== null ? Number(codeRaw) : null;
    const payCodeIdRaw = fd.get("payCodeId");
    return {
      name: fd.get("name") as string,
      category: fd.get("category") as "PTO",
      accrualRateMinutes: 0,
      maxBalanceMinutes: hasMax ? toMins(fd, "maxBalance") || null : null,
      requiresApproval: fd.get("requiresApproval") === "true",
      isPaid: fd.get("isPaid") === "true",
      accrualTracked: fd.get("accrualTracked") !== "false",
      externalCode,
      payCodeId: payCodeIdRaw && payCodeIdRaw !== "" ? (payCodeIdRaw as string) : null,
    };
  }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await createLeaveType(parseForm(fd));
      if (!result.success) { setError(result.error); return; }
      closeCreate();
      router.refresh();
    });
  }

  function handleUpdate(lt: LeaveType, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await updateLeaveType({ leaveTypeId: lt.id, isActive: fd.get("isActive") === "true", ...parseForm(fd) });
      if (!result.success) { setError(result.error); return; }
      closeEdit();
      router.refresh();
    });
  }

  return (
    <div className="mt-4 flex flex-col gap-2.5">
      <Toolbar count={visible.length} countLabel="leave type">
        <SegmentedControl
          items={VIEWS}
          value={view}
          onChange={(v) => setView(v as View)}
          size="sm"
          ariaLabel="Which leave types to show"
        />
        <Button onClick={openCreate}>New Leave Type</Button>
      </Toolbar>

      <Card padding={0}>
        {visible.length === 0 ? (
          <EmptyState
            icon={<Palmtree className="h-8 w-8" />}
            title={view === "active" ? "No active leave types" : view === "inactive" ? "No retired leave types" : "No leave types"}
            body="A leave type is what someone picks when they request time off, and what their balance is held against."
            action={<Button size="sm" onClick={openCreate}>New Leave Type</Button>}
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Leave Type</TH>
                  <TH numeric style={{ width: 80 }}>Code</TH>
                  <TH>Category</TH>
                  <TH>Paid</TH>
                  <TH>Approval</TH>
                  <TH numeric>Max Balance</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {visible.map((lt) => (
                  <TR key={lt.id} onClick={() => openEdit(lt)}>
                    <TD style={{ fontWeight: "var(--weight-medium)" }}>{lt.name}</TD>
                    <TD numeric style={{ color: "var(--text-secondary)" }}>
                      {lt.externalCode ?? <span style={{ color: "var(--text-tertiary)" }}>—</span>}
                    </TD>
                    <TD style={{ color: "var(--text-secondary)" }}>{lt.category}</TD>
                    <TD>
                      {/* Not a status — whether the hours are paid is the fact
                          that decides everything else about the type, so it
                          carries the design's own success/neutral pair. */}
                      <Badge tone={lt.isPaid ? "success" : "neutral"} size="sm">
                        {lt.isPaid ? "Paid" : "Unpaid"}
                      </Badge>
                    </TD>
                    <TD style={{ color: "var(--text-secondary)" }}>
                      {lt.requiresApproval ? "Supervisor" : "Automatic"}
                    </TD>
                    <TD numeric style={{ color: "var(--text-secondary)" }}>
                      {lt.maxBalanceMinutes != null
                        ? formatMinutes(lt.maxBalanceMinutes)
                        : <span style={{ color: "var(--text-tertiary)" }}>No cap</span>}
                    </TD>
                    <TD>
                      {lt.isActive ? (
                        <Badge tone={statusTone("ACTIVE")} size="sm" dot>Active</Badge>
                      ) : (
                        // statusTone would answer "warning"; a leave type that
                        // is no longer offered is not something to go and fix.
                        <Badge size="sm">Inactive</Badge>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <TableFooter
              shown={visible.length}
              total={leaveTypes.length}
              label={leaveTypes.length === 1 ? "leave type" : "leave types"}
            />
          </>
        )}
      </Card>

      {showCreate && (
        <Modal title="New Leave Type" onClose={closeCreate}>
          {error && <div className="mb-4"><Banner tone="error" body={error} /></div>}
          <form onSubmit={handleCreate}>
            <LeaveTypeFields payCodes={payCodes} />
            <div className="mt-5 flex gap-2 pt-4" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
              <Button type="submit" disabled={isPending}>{isPending ? "Creating…" : "Create"}</Button>
              <Button type="button" hierarchy="secondary" onClick={closeCreate}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}

      {editingLt && (
        <Modal title={`Edit: ${editingLt.name}`} onClose={closeEdit}>
          {error && <div className="mb-4"><Banner tone="error" body={error} /></div>}
          <form onSubmit={(e) => handleUpdate(editingLt, e)}>
            <LeaveTypeFields lt={editingLt} payCodes={payCodes} />
            <div className={`mt-3 ${FIELD_GRID}`}>
              <SelectField label="Status" name="isActive" defaultValue={editingLt.isActive ? "true" : "false"}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </SelectField>
            </div>
            <div className="mt-5 flex gap-2 pt-4" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
              <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Save changes"}</Button>
              <Button type="button" hierarchy="secondary" onClick={closeEdit}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
