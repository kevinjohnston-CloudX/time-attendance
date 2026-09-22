"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { GripVertical, Receipt, X } from "lucide-react";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { createPayCode, updatePayCode, reorderPayCodes } from "@/actions/pay-code.actions";
import type { PayCode } from "@prisma/client";
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
 * Pay codes, on the design's list template.
 *
 * <p>The design's Pay Codes list carries a Rate column; there is no multiplier
 * on a PayCode here — the rate comes from the rule set that posts the hours —
 * so it is left out rather than shown as 1.00 for everything.
 *
 * <p>Order is data on this screen: the sort order decides which code a
 * timecard row offers first, so the rows stay draggable and the grip stays in
 * the first column where it can be found without hovering the whole row.
 */

interface Props { payCodes: PayCode[] }

const PAY_BUCKETS = ["REG","OT","DT","PTO","SICK","HOLIDAY","FMLA","BEREAVEMENT","JURY_DUTY","MILITARY","UNPAID"] as const;

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
        className="ta-modal max-h-[90vh] w-full max-w-lg overflow-y-auto"
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

function PayCodeFields({ pc }: { pc?: PayCode }) {
  return (
    <div className={FIELD_GRID}>
      <Input label="Numeric Code" name="code" type="number" min={0} required defaultValue={pc?.code ?? ""} placeholder="e.g. 5" />
      <Input label="Label" name="label" required defaultValue={pc?.label ?? ""} placeholder="e.g. PTO" />
      <Input
        label="Express Code"
        name="expressCode"
        maxLength={4}
        defaultValue={pc?.expressCode ?? ""}
        placeholder="e.g. WKHR"
        style={{ textTransform: "uppercase" }}
      />
      <SelectField label="Pay Bucket" name="payBucket" defaultValue={pc?.payBucket ?? ""}>
        <option value="">— None —</option>
        {PAY_BUCKETS.map((b) => <option key={b} value={b}>{b}</option>)}
      </SelectField>
      {/* The two options are sentences, not words — they need the full row or
          the one that decides whether hours reach an OT threshold truncates. */}
      <div style={{ gridColumn: "1 / -1" }}>
        <SelectField
          label="Overtime Calculation"
          name="countsTowardOt"
          defaultValue={pc ? (pc.countsTowardOt ? "true" : "false") : "true"}
        >
          <option value="true">Counts toward OT — hours apply to daily and weekly OT thresholds</option>
          <option value="false">Excluded from OT — hours stay REG regardless of daily or weekly totals</option>
        </SelectField>
      </div>
    </div>
  );
}

export function PayCodesManager({ payCodes }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingPc, setEditingPc] = useState<PayCode | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [view, setView] = useState<View>("active");
  const [items, setItems] = useState<PayCode[]>(() => [...payCodes].sort((a, b) => a.sortOrder - b.sortOrder));
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  useEffect(() => {
    setItems([...payCodes].sort((a, b) => a.sortOrder - b.sortOrder));
  }, [payCodes]);

  const visible = items.filter((p) =>
    view === "all" ? true : view === "active" ? p.isActive : !p.isActive,
  );

  function openEdit(pc: PayCode) { setEditingPc(pc); setError(null); }
  function closeEdit() { setEditingPc(null); setError(null); }
  function openCreate() { setShowCreate(true); setError(null); }
  function closeCreate() { setShowCreate(false); setError(null); }

  function handleDragStart(id: string) { setDragId(id); }
  function handleDragOver(e: React.DragEvent, id: string) { e.preventDefault(); if (id !== dragId) setDragOverId(id); }
  function handleDragEnd() { setDragId(null); setDragOverId(null); }

  function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    if (!dragId || dragId === targetId) { setDragId(null); setDragOverId(null); return; }
    const arr = [...items];
    const srcIdx = arr.findIndex((p) => p.id === dragId);
    const tgtIdx = arr.findIndex((p) => p.id === targetId);
    const [item] = arr.splice(srcIdx, 1);
    arr.splice(tgtIdx, 0, item);
    setItems(arr);
    setDragId(null);
    setDragOverId(null);
    startTransition(async () => { await reorderPayCodes({ orderedIds: arr.map((p) => p.id) }); router.refresh(); });
  }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await createPayCode({
        code: Number(fd.get("code")),
        label: fd.get("label") as string,
        expressCode: (fd.get("expressCode") as string) || null,
        payBucket: (fd.get("payBucket") as string) || null,
        countsTowardOt: fd.get("countsTowardOt") !== "false",
      });
      if (!result.success) { setError(result.error); return; }
      closeCreate();
      router.refresh();
    });
  }

  function handleUpdate(pc: PayCode, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const sortOrder = items.findIndex((p) => p.id === pc.id);
    setError(null);
    startTransition(async () => {
      const result = await updatePayCode({
        payCodeId: pc.id,
        code: Number(fd.get("code")),
        label: fd.get("label") as string,
        expressCode: (fd.get("expressCode") as string) || null,
        payBucket: (fd.get("payBucket") as string) || null,
        countsTowardOt: fd.get("countsTowardOt") !== "false",
        sortOrder,
        isActive: fd.get("isActive") === "true",
      });
      if (!result.success) { setError(result.error); return; }
      closeEdit();
      router.refresh();
    });
  }

  return (
    <div className="mt-4 flex flex-col gap-2.5">
      <Toolbar count={visible.length} countLabel="pay code">
        <SegmentedControl
          items={VIEWS}
          value={view}
          onChange={(v) => setView(v as View)}
          size="sm"
          ariaLabel="Which pay codes to show"
        />
        <Button onClick={openCreate}>New Pay Code</Button>
      </Toolbar>

      <Card padding={0}>
        {visible.length === 0 ? (
          <EmptyState
            icon={<Receipt className="h-8 w-8" />}
            title={view === "active" ? "No active pay codes" : view === "inactive" ? "No retired pay codes" : "No pay codes"}
            body="A pay code is the payroll line an hour is posted to. Drag the rows to set the order they are offered in."
            action={<Button size="sm" onClick={openCreate}>New Pay Code</Button>}
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH style={{ width: 36 }} aria-label="Reorder" />
                  <TH numeric style={{ width: 72 }}>Code</TH>
                  <TH>Label</TH>
                  <TH>Express</TH>
                  <TH>Pay Bucket</TH>
                  <TH align="center">Counts to OT</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {visible.map((pc) => (
                  // A plain <tr>: the kit's TR takes a click and a selected
                  // flag, and the drag props have nowhere to go on it.
                  // components/ui is shared, so the row is spelled out here
                  // and the cells still come from the kit.
                  <tr
                    key={pc.id}
                    className="ta-row"
                    draggable
                    onDragStart={() => handleDragStart(pc.id)}
                    onDragOver={(e) => handleDragOver(e, pc.id)}
                    onDrop={(e) => handleDrop(e, pc.id)}
                    onDragEnd={handleDragEnd}
                    onClick={() => openEdit(pc)}
                    style={{
                      cursor: "pointer",
                      opacity: dragId === pc.id ? 0.4 : 1,
                      background: dragOverId === pc.id ? "var(--surface-info)" : undefined,
                    }}
                  >
                    <TD>
                      <GripVertical
                        className="h-4 w-4 cursor-grab active:cursor-grabbing"
                        style={{ color: "var(--icon-tertiary)" }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </TD>
                    <TD numeric style={{ fontWeight: "var(--weight-medium)" }}>{pc.code}</TD>
                    <TD style={{ fontWeight: "var(--weight-medium)" }}>{pc.label}</TD>
                    <TD style={{ font: "var(--type-body2)", fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                      {pc.expressCode || <span style={{ color: "var(--text-tertiary)" }}>—</span>}
                    </TD>
                    <TD style={{ color: "var(--text-secondary)" }}>
                      {pc.payBucket || <span style={{ color: "var(--text-tertiary)" }}>—</span>}
                    </TD>
                    <TD align="center" style={{ color: pc.countsTowardOt ? "var(--text-secondary)" : "var(--text-warning)" }}>
                      {pc.countsTowardOt ? "Yes" : "No"}
                    </TD>
                    <TD>
                      {pc.isActive ? (
                        <Badge tone={statusTone("ACTIVE")} size="sm" dot>Active</Badge>
                      ) : (
                        // statusTone would answer "warning"; a retired pay code
                        // is not a warning, it is simply no longer offered.
                        <Badge size="sm">Inactive</Badge>
                      )}
                    </TD>
                  </tr>
                ))}
              </TBody>
            </Table>
            <TableFooter
              shown={visible.length}
              total={items.length}
              label={items.length === 1 ? "pay code" : "pay codes"}
            />
          </>
        )}
      </Card>

      {showCreate && (
        <Modal title="New Pay Code" onClose={closeCreate}>
          {error && <div className="mb-4"><Banner tone="error" body={error} /></div>}
          <form onSubmit={handleCreate}>
            <PayCodeFields />
            <div className="mt-5 flex gap-2 pt-4" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
              <Button type="submit" disabled={isPending}>{isPending ? "Creating…" : "Create"}</Button>
              <Button type="button" hierarchy="secondary" onClick={closeCreate}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}

      {editingPc && (
        <Modal title={`Edit: ${editingPc.label}`} onClose={closeEdit}>
          {error && <div className="mb-4"><Banner tone="error" body={error} /></div>}
          <form onSubmit={(e) => handleUpdate(editingPc, e)}>
            <PayCodeFields pc={editingPc} />
            <div className={`mt-3 ${FIELD_GRID}`}>
              <SelectField label="Status" name="isActive" defaultValue={editingPc.isActive ? "true" : "false"}>
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
