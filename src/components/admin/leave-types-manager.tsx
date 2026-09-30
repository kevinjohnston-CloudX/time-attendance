"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/components/layout/navigation-progress";
import { Palmtree, Plus } from "lucide-react";
import type { LeaveType } from "@prisma/client";
import { createLeaveType, updateLeaveType } from "@/actions/admin.actions";
import { Badge, Button, EmptyState, Input, Select, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import {
  AreaPanel,
  ChoiceField,
  FIELD_GRID,
  LEAVE_CATEGORY_LABEL,
  Muted,
  SelectField,
  SetupDialog,
  StatusBadge,
  StatusField,
  countLine,
  hoursText,
  matches,
  saveError,
  useStatusView,
  useOpenFromLink,
} from "./setup/setup-ui";

/**
 * Leave types: what someone picks when they request time off, and what
 * their balance is held against.
 *
 * <p>Balances are kept in minutes and shown in hours. How fast a balance
 * grows is set by the leave policies in Rules Setup, not here, so saving a
 * leave type keeps whatever accrual rate it already carries rather than
 * resetting it to zero, which the old form did.
 */

interface PayCodeOption {
  id: string;
  code: number;
  label: string;
  isActive?: boolean;
}

const CATEGORIES = ["PTO", "SICK", "HOLIDAY", "FMLA", "BEREAVEMENT", "JURY_DUTY", "MILITARY", "UNPAID"] as const;

export function LeaveTypesManager({ leaveTypes, payCodes }: { leaveTypes: LeaveType[]; payCodes: PayCodeOption[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<LeaveType | "new" | null>(null);
  const [query, setQuery] = useState("");
  const { view, setView, counts, kept } = useStatusView(leaveTypes);
  const payCode = new Map(payCodes.map((p) => [p.id, p]));
  const shown = kept.filter((lt) =>
    matches(query, lt.name, LEAVE_CATEGORY_LABEL[lt.category], lt.externalCode, lt.payCodeId && payCode.get(lt.payCodeId)?.label),
  );

  function open(lt: LeaveType | "new") {
    setEditing(lt);
    setError(null);
  }
  // A link from elsewhere (an employee record, a classic address) opens its record.
  useOpenFromLink(leaveTypes, open);
  function close() {
    setEditing(null);
    setError(null);
  }

  function save(form: FormData) {
    const hours = String(form.get("maxHours") ?? "").trim();
    const mins = Number(form.get("maxMins") ?? 0);
    const max = hours === "" ? null : Number(hours) * 60 + mins || null;
    const code = String(form.get("externalCode") ?? "").trim();
    const fields = {
      name: String(form.get("name") ?? "").trim(),
      category: String(form.get("category")) as (typeof CATEGORIES)[number],
      accrualRateMinutes: editing && editing !== "new" ? editing.accrualRateMinutes : 0,
      maxBalanceMinutes: max,
      requiresApproval: form.get("requiresApproval") === "true",
      isPaid: form.get("isPaid") === "true",
      accrualTracked: form.get("accrualTracked") === "true",
      // Empty on a new type takes the next number; on an existing one it
      // keeps the code it has, since clearing it would break the API link.
      externalCode: code === "" ? (editing && editing !== "new" ? editing.externalCode : null) : Number(code),
      payCodeId: String(form.get("payCodeId") ?? "") || null,
    };
    setError(null);
    startTransition(async () => {
      const result =
        editing === "new"
          ? await createLeaveType(fields)
          : await updateLeaveType({ ...fields, leaveTypeId: (editing as LeaveType).id, isActive: form.get("isActive") === "true" });
      if (!result.success) return setError(saveError(result.error));
      close();
      router.refresh();
    });
  }

  const addButton = (
    <Button onClick={() => open("new")} leadingIcon={<Plus className="h-4 w-4" />}>
      Add leave type
    </Button>
  );

  return (
    <>
      <AreaPanel
        title="Leave types"
        hint="What people pick when they request time off, and what their balance is held against."
        action={addButton}
        status={{ view, onChange: setView, counts }}
        search={leaveTypes.length ? { value: query, onChange: setQuery, placeholder: "Leave type or code" } : undefined}
        count={countLine(shown.length, leaveTypes.length, "leave type", "leave types")}
      >
        {leaveTypes.length === 0 ? (
          <EmptyState
            icon={<Palmtree className="h-8 w-8" />}
            title="No leave types yet"
            body="Add the first one, such as Paid time off or Sick."
            action={addButton}
          />
        ) : shown.length === 0 ? (
          <EmptyState icon={<Palmtree className="h-8 w-8" />} title="No leave types match" body="Nothing matches that search or status." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Leave type</TH>
                <TH>Pay</TH>
                <TH>Approval</TH>
                <TH>Balance</TH>
                <TH>Pay code</TH>
                <TH numeric>API code</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {shown.map((lt) => {
                const pc = lt.payCodeId ? payCode.get(lt.payCodeId) : undefined;
                return (
                  <TR key={lt.id} onClick={() => open(lt)}>
                    <TD>
                      <span className="flex flex-col">
                        <span style={{ fontWeight: "var(--weight-medium)" }}>{lt.name}</span>
                        {(LEAVE_CATEGORY_LABEL[lt.category] ?? lt.category).toLowerCase() !== lt.name.toLowerCase() && (
                          <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                            {LEAVE_CATEGORY_LABEL[lt.category] ?? lt.category}
                          </span>
                        )}
                      </span>
                    </TD>
                    <TD>
                      {lt.isPaid ? (
                        <Badge tone="success" size="sm">
                          Paid
                        </Badge>
                      ) : (
                        <Badge size="sm">Unpaid</Badge>
                      )}
                    </TD>
                    <TD style={{ color: "var(--text-secondary)" }}>{lt.requiresApproval ? "Supervisor approves" : "Automatic"}</TD>
                    <TD style={{ color: "var(--text-secondary)" }}>
                      {!lt.accrualTracked ? (
                        <Muted>Not tracked</Muted>
                      ) : lt.maxBalanceMinutes ? (
                        `Up to ${hoursText(lt.maxBalanceMinutes)}`
                      ) : (
                        "No cap"
                      )}
                    </TD>
                    <TD style={{ color: "var(--text-secondary)" }}>
                      {pc ? (
                        <span>
                          <span className="tabular">{pc.code}</span> {pc.label}
                        </span>
                      ) : (
                        <Muted />
                      )}
                    </TD>
                    <TD numeric style={{ color: "var(--text-secondary)" }}>
                      {lt.externalCode ?? <Muted />}
                    </TD>
                    <TD>
                      <StatusBadge active={lt.isActive} />
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </AreaPanel>

      {editing && (
        <LeaveTypeDialog
          leaveType={editing === "new" ? null : editing}
          payCodes={payCodes}
          pending={isPending}
          error={error}
          onSubmit={save}
          onClose={close}
        />
      )}
    </>
  );
}

function LeaveTypeDialog({
  leaveType: lt,
  payCodes,
  pending,
  error,
  onSubmit,
  onClose,
}: {
  leaveType: LeaveType | null;
  payCodes: PayCodeOption[];
  pending: boolean;
  error: string | null;
  onSubmit: (form: FormData) => void;
  onClose: () => void;
}) {
  const [tracked, setTracked] = useState(lt?.accrualTracked ?? true);
  // Active codes, plus the one already picked if it has since been retired.
  const codes = payCodes.filter((p) => p.isActive !== false || p.id === lt?.payCodeId);
  const max = lt?.maxBalanceMinutes ?? null;

  return (
    <SetupDialog
      title={lt ? lt.name : "Add leave type"}
      subtitle={lt ? "Edit leave type" : undefined}
      submitLabel={lt ? "Save changes" : "Add leave type"}
      pending={pending}
      error={error}
      onSubmit={onSubmit}
      onClose={onClose}
      width={600}
    >
      <div className={FIELD_GRID}>
        <Input label="Name" name="name" required defaultValue={lt?.name ?? ""} placeholder="Paid time off" />
        <SelectField label="Category" name="category" required defaultValue={lt?.category ?? ""}>
          <option value="" disabled>
            Choose a category
          </option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {LEAVE_CATEGORY_LABEL[c]}
            </option>
          ))}
        </SelectField>
      </div>

      <div className={FIELD_GRID}>
        <ChoiceField
          label="Pay"
          name="isPaid"
          defaultValue={lt?.isPaid === false ? "false" : "true"}
          options={[
            { value: "true", label: "Paid" },
            { value: "false", label: "Unpaid" },
          ]}
        />
        <ChoiceField
          label="Approval"
          name="requiresApproval"
          defaultValue={lt?.requiresApproval === false ? "false" : "true"}
          options={[
            { value: "true", label: "Supervisor approves" },
            { value: "false", label: "Automatic" },
          ]}
        />
      </div>

      <div className="flex flex-col gap-3">
        <ChoiceField
          label="Balance"
          name="accrualTracked"
          defaultValue={tracked ? "true" : "false"}
          onChange={(v) => setTracked(v === "true")}
          options={[
            { value: "true", label: "Tracked" },
            { value: "false", label: "Not tracked" },
          ]}
          hint={
            tracked
              ? "CloudTime keeps a balance for each person."
              : "No balance is kept. Requests are recorded for information only."
          }
        />
        <div className="flex flex-col gap-1.5">
          <span className="wms-label">Most anyone can hold</span>
          <span className="flex items-center gap-2">
            <span className="w-28">
              <Input
                name="maxHours"
                type="number"
                min={0}
                step={1}
                defaultValue={max ? String(Math.floor(max / 60)) : ""}
                placeholder="No cap"
                aria-label="Most anyone can hold, hours"
              />
            </span>
            <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>h</span>
            <span className="w-24">
              <Select aria-label="Most anyone can hold, minutes" name="maxMins" defaultValue={String(max ? max % 60 : 0)} style={{ width: "100%" }}>
                {[0, 15, 30, 45].map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </Select>
            </span>
          </span>
          <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>Leave the hours empty for no cap.</span>
        </div>
      </div>

      <div className={FIELD_GRID}>
        {codes.length > 0 ? (
          <SelectField label="Pay code" name="payCodeId" defaultValue={lt?.payCodeId ?? ""} hint="The timecard line this leave is posted to.">
            <option value="">None</option>
            {codes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} {p.label}
                {p.isActive === false ? " (inactive)" : ""}
              </option>
            ))}
          </SelectField>
        ) : (
          <input type="hidden" name="payCodeId" value={lt?.payCodeId ?? ""} />
        )}
        <Input
          label="API code"
          name="externalCode"
          type="number"
          min={1}
          step={1}
          defaultValue={lt?.externalCode != null ? String(lt.externalCode) : ""}
          placeholder="Next number"
          hint={lt ? "The number other systems know this leave type by." : "Optional. Left empty, the next free number is used."}
        />
      </div>

      {lt && <StatusField defaultActive={lt.isActive} />}
    </SetupDialog>
  );
}
