"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "@/components/layout/navigation-progress";
import { GripVertical, Plus, Receipt } from "lucide-react";
import type { PayCode } from "@prisma/client";
import { createPayCode, updatePayCode, reorderPayCodes } from "@/actions/pay-code.actions";
import { Banner, Button, EmptyState, Input, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import {
  AreaPanel,
  ChoiceField,
  FIELD_GRID,
  Muted,
  SelectField,
  SetupDialog,
  StatusBadge,
  StatusField,
  countLine,
  matches,
  saveError,
  useStatusView,
} from "./setup/setup-ui";

/**
 * Pay codes: the payroll lines hours are posted to.
 *
 * <p>Order is data here: timecards offer the codes in this order, so the
 * rows stay draggable. A new order is saved in one go; if it fails the list
 * goes back to the order that is actually stored and says so, where it
 * used to keep showing the new order as if it had saved.
 *
 * <p>There is no delete, as before: a pay code sits on punches and
 * timecard lines, so one that is no longer used is set to inactive.
 */

const PAY_BUCKET_LABEL: Record<string, string> = {
  REG: "Regular",
  OT: "Overtime",
  DT: "Double time",
  PTO: "Paid time off",
  SICK: "Sick",
  HOLIDAY: "Holiday",
  FMLA: "FMLA",
  BEREAVEMENT: "Bereavement",
  JURY_DUTY: "Jury duty",
  MILITARY: "Military",
  UNPAID: "Unpaid",
};

const byOrder = (list: PayCode[]) => [...list].sort((a, b) => a.sortOrder - b.sortOrder);

export function PayCodesManager({ payCodes }: { payCodes: PayCode[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PayCode | "new" | null>(null);
  const [query, setQuery] = useState("");

  const [items, setItems] = useState<PayCode[]>(() => byOrder(payCodes));
  useEffect(() => setItems(byOrder(payCodes)), [payCodes]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [ordering, startOrdering] = useTransition();
  const [orderError, setOrderError] = useState<string | null>(null);

  const { view, setView, counts, kept } = useStatusView(items);
  const shown = kept.filter((p) => matches(query, p.code, p.label, p.expressCode, p.payBucket && PAY_BUCKET_LABEL[p.payBucket]));

  function open(p: PayCode | "new") {
    setEditing(p);
    setError(null);
  }
  function close() {
    setEditing(null);
    setError(null);
  }

  function endDrag() {
    setDragId(null);
    setOverId(null);
  }

  function drop(targetId: string) {
    if (!dragId || dragId === targetId) return endDrag();
    const before = items;
    const next = [...items];
    const [moved] = next.splice(next.findIndex((p) => p.id === dragId), 1);
    next.splice(next.findIndex((p) => p.id === targetId), 0, moved);
    setItems(next);
    setOrderError(null);
    endDrag();
    startOrdering(async () => {
      const result = await reorderPayCodes({ orderedIds: next.map((p) => p.id) });
      if (!result.success) {
        setItems(before);
        setOrderError(saveError(result.error));
        return;
      }
      router.refresh();
    });
  }

  function save(form: FormData) {
    const fields = {
      code: Number(form.get("code")),
      label: String(form.get("label") ?? "").trim(),
      expressCode: String(form.get("expressCode") ?? "").trim() || null,
      payBucket: String(form.get("payBucket") ?? "") || null,
      countsTowardOt: form.get("countsTowardOt") !== "false",
    };
    setError(null);
    startTransition(async () => {
      const result =
        editing === "new"
          ? await createPayCode(fields)
          : await updatePayCode({
              ...fields,
              payCodeId: (editing as PayCode).id,
              sortOrder: Math.max(0, items.findIndex((p) => p.id === (editing as PayCode).id)),
              isActive: form.get("isActive") === "true",
            });
      if (!result.success) return setError(saveError(result.error));
      close();
      router.refresh();
    });
  }

  const addButton = (
    <Button onClick={() => open("new")} leadingIcon={<Plus className="h-4 w-4" />}>
      Add pay code
    </Button>
  );

  return (
    <>
      <AreaPanel
        title="Pay codes"
        hint="The payroll lines hours are posted to. Timecards list them in this order. Drag a row to move it."
        action={addButton}
        status={{ view, onChange: setView, counts }}
        search={items.length ? { value: query, onChange: setQuery, placeholder: "Code, name or bucket" } : undefined}
        count={ordering ? "Saving the new order…" : countLine(shown.length, items.length, "pay code", "pay codes")}
      >
        {orderError && (
          <div className="px-5 pt-3.5">
            <Banner tone="error" title="The new order was not saved" body={orderError} />
          </div>
        )}
        {items.length === 0 ? (
          <EmptyState
            icon={<Receipt className="h-8 w-8" />}
            title="No pay codes yet"
            body="Add the first one. Code 0 is regular worked time."
            action={addButton}
          />
        ) : shown.length === 0 ? (
          <EmptyState icon={<Receipt className="h-8 w-8" />} title="No pay codes match" body="Nothing matches that search or status." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH style={{ width: 40 }} aria-label="Order" />
                <TH numeric style={{ width: 72 }}>
                  Code
                </TH>
                <TH>Pay code</TH>
                <TH>Express code</TH>
                <TH>Pay bucket</TH>
                <TH>Overtime</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {shown.map((p) => (
                // A plain row: the kit's TR has nowhere to put the drag handlers.
                <tr
                  key={p.id}
                  className="ta-row"
                  draggable={!ordering}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    setDragId(p.id);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (p.id !== dragId) setOverId(p.id);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    drop(p.id);
                  }}
                  onDragEnd={endDrag}
                  onClick={() => open(p)}
                  style={{
                    cursor: "pointer",
                    opacity: dragId === p.id ? 0.45 : 1,
                    background: overId === p.id ? "var(--surface-info)" : undefined,
                  }}
                >
                  <TD>
                    <span
                      className="flex cursor-grab items-center active:cursor-grabbing"
                      title="Drag to move"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <GripVertical className="h-4 w-4" style={{ color: "var(--icon-tertiary)" }} aria-hidden="true" />
                    </span>
                  </TD>
                  <TD numeric style={{ fontWeight: "var(--weight-semibold)" }}>
                    {p.code}
                  </TD>
                  <TD style={{ fontWeight: "var(--weight-medium)" }}>{p.label}</TD>
                  <TD style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>{p.expressCode || <Muted />}</TD>
                  <TD style={{ color: "var(--text-secondary)" }}>
                    {p.payBucket ? (PAY_BUCKET_LABEL[p.payBucket] ?? p.payBucket) : <Muted />}
                  </TD>
                  <TD style={{ color: "var(--text-secondary)" }}>{p.countsTowardOt ? "Counts" : <Muted>Excluded</Muted>}</TD>
                  <TD>
                    <StatusBadge active={p.isActive} />
                  </TD>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
      </AreaPanel>

      {editing && (
        <PayCodeDialog payCode={editing === "new" ? null : editing} pending={isPending} error={error} onSubmit={save} onClose={close} />
      )}
    </>
  );
}

function PayCodeDialog({
  payCode: p,
  pending,
  error,
  onSubmit,
  onClose,
}: {
  payCode: PayCode | null;
  pending: boolean;
  error: string | null;
  onSubmit: (form: FormData) => void;
  onClose: () => void;
}) {
  const [counts, setCounts] = useState(p?.countsTowardOt ?? true);
  return (
    <SetupDialog
      title={p ? `${p.code} ${p.label}` : "Add pay code"}
      subtitle={p ? "Edit pay code" : undefined}
      submitLabel={p ? "Save changes" : "Add pay code"}
      pending={pending}
      error={error}
      onSubmit={onSubmit}
      onClose={onClose}
    >
      <div className="grid gap-x-4 gap-y-3.5 [grid-template-columns:120px_minmax(0,1fr)]">
        <Input label="Code" name="code" type="number" min={0} step={1} required defaultValue={p ? String(p.code) : ""} placeholder="5" />
        <Input label="Name" name="label" required maxLength={100} defaultValue={p?.label ?? ""} placeholder="Paid time off" />
      </div>
      <span style={{ marginTop: -6, font: "var(--type-caption1)", color: "var(--text-tertiary)", textWrap: "pretty" }}>
        Code 0 is regular worked time. Saving it active puts worked hours that have no pay code on it.
      </span>

      <div className={FIELD_GRID}>
        <Input
          label="Express code"
          name="expressCode"
          maxLength={4}
          defaultValue={p?.expressCode ?? ""}
          placeholder="WKHR"
          hint="Optional. Up to 4 letters."
          style={{ textTransform: "uppercase" }}
        />
        <SelectField label="Pay bucket" name="payBucket" defaultValue={p?.payBucket ?? ""}>
          <option value="">None</option>
          {Object.entries(PAY_BUCKET_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
      </div>

      <ChoiceField
        label="Overtime"
        name="countsTowardOt"
        defaultValue={counts ? "true" : "false"}
        onChange={(v) => setCounts(v === "true")}
        options={[
          { value: "true", label: "Counts toward overtime" },
          { value: "false", label: "Excluded" },
        ]}
        hint={
          counts
            ? "These hours add up toward the daily and weekly overtime thresholds."
            : "These hours stay regular, whatever the daily or weekly totals."
        }
      />

      {p && <StatusField defaultActive={p.isActive} />}
    </SetupDialog>
  );
}
