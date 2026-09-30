"use client";

import { useMemo, useState, useTransition } from "react";
import { format } from "date-fns";
import { useRouter } from "@/components/layout/navigation-progress";
import { Plus, Users } from "lucide-react";
import { createAgency, updateAgency, deleteAgency } from "@/actions/agency.actions";
import { Button, EmptyState, Input, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import {
  AreaPanel,
  DeleteAction,
  Muted,
  SetupDialog,
  StatusBadge,
  countLine,
  matches,
  saveError,
  useOpenFromLink,
  useStatusView,
} from "./setup/setup-ui";
import { parseUtcDate } from "@/lib/utils/date";

/**
 * Agencies: the staffing agencies people are placed through, by the number
 * payroll knows each one by, with its labor and charge rates and the most
 * hours a person may work through it.
 *
 * <p>Built in Company Setup's language from John's Agencies screen, which had
 * its own list and a page per form. The same fields and the same permission
 * (RULES_MANAGE). An agency has no on and off switch: it stops being offered
 * from its inactive date, so that date is what its status is read from. One
 * that anyone is still in cannot be deleted.
 */

interface Agency {
  id: string;
  code: number;
  description: string;
  /** Decimals arrive as strings once serialized for the client. */
  laborRate: number | string;
  chargeRate: number | string;
  maxWorkHours: number | string;
  inactiveOn: string | Date | null;
  _count?: { employees: number };
}

type Row = Agency & { isActive: boolean };

/** Rates keep up to six decimals, as payroll stores them, but never fewer than cents. */
function rate(v: number | string): string | null {
  const n = Number(v);
  if (!n) return null;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
}

export function AgenciesManager({ agencies }: { agencies: Agency[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [query, setQuery] = useState("");

  // Active until the day its inactive date arrives.
  const rows: Row[] = useMemo(() => {
    const today = format(new Date(), "yyyy-MM-dd");
    return agencies.map((a) => ({
      ...a,
      isActive: !a.inactiveOn || format(parseUtcDate(a.inactiveOn), "yyyy-MM-dd") > today,
    }));
  }, [agencies]);
  const { view, setView, counts, kept } = useStatusView(rows);
  const shown = kept.filter((a) => matches(query, a.code, a.description));

  function open(a: Row | "new") {
    setEditing(a);
    setError(null);
  }
  function close() {
    setEditing(null);
    setError(null);
  }
  useOpenFromLink(rows, open);

  function save(form: FormData) {
    const num = (k: string) => {
      const v = String(form.get(k) ?? "").trim();
      return v === "" ? 0 : Number(v);
    };
    const fields = {
      code: Number(form.get("code")),
      description: String(form.get("description") ?? "").trim(),
      laborRate: num("laborRate"),
      chargeRate: num("chargeRate"),
      maxWorkHours: num("maxWorkHours"),
      inactiveOn: String(form.get("inactiveOn") ?? "") || null,
    };
    setError(null);
    startTransition(async () => {
      const result = editing === "new" ? await createAgency(fields) : await updateAgency({ ...fields, id: (editing as Row).id });
      if (!result.success) return setError(saveError(result.error));
      close();
      router.refresh();
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteAgency({ id });
      if (!result.success) return setError(saveError(result.error));
      close();
      router.refresh();
    });
  }

  const addButton = (
    <Button onClick={() => open("new")} leadingIcon={<Plus className="h-4 w-4" />}>
      Add agency
    </Button>
  );

  return (
    <>
      <AreaPanel
        title="Agencies"
        hint="The staffing agencies people are placed through, with their rates and the most hours a person may work through them."
        action={addButton}
        status={{ view, onChange: setView, counts }}
        search={agencies.length ? { value: query, onChange: setQuery, placeholder: "Number or name" } : undefined}
        count={countLine(shown.length, agencies.length, "agency", "agencies")}
      >
        {agencies.length === 0 ? (
          <EmptyState icon={<Users className="h-8 w-8" />} title="No agencies yet" body="Add the first staffing agency people are placed through." action={addButton} />
        ) : shown.length === 0 ? (
          <EmptyState icon={<Users className="h-8 w-8" />} title="No agencies match" body="Nothing matches that search or status." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH numeric>No.</TH>
                <TH>Agency</TH>
                <TH numeric>Labor rate</TH>
                <TH numeric>Charge rate</TH>
                <TH numeric>Max hours</TH>
                <TH numeric>Employees</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {shown.map((a) => {
                const people = a._count?.employees ?? 0;
                const max = Number(a.maxWorkHours);
                return (
                  <TR key={a.id} onClick={() => open(a)}>
                    <TD numeric style={{ fontWeight: "var(--weight-semibold)" }}>
                      {a.code}
                    </TD>
                    <TD style={{ fontWeight: "var(--weight-medium)" }}>{a.description}</TD>
                    <TD numeric>{rate(a.laborRate) ?? <Muted>Not set</Muted>}</TD>
                    <TD numeric>{rate(a.chargeRate) ?? <Muted>Not set</Muted>}</TD>
                    <TD numeric>{max ? max.toLocaleString("en-US", { maximumFractionDigits: 2 }) : <Muted>No limit</Muted>}</TD>
                    <TD numeric style={{ color: people ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                      {people.toLocaleString()}
                    </TD>
                    <TD>
                      <StatusBadge active={a.isActive} />
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </AreaPanel>

      {editing && (
        <AgencyDialog agency={editing === "new" ? null : editing} pending={isPending} error={error} onSubmit={save} onDelete={remove} onClose={close} />
      )}
    </>
  );
}

function AgencyDialog({
  agency: a,
  pending,
  error,
  onSubmit,
  onDelete,
  onClose,
}: {
  agency: Row | null;
  pending: boolean;
  error: string | null;
  onSubmit: (form: FormData) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const people = a?._count?.employees ?? 0;
  const numberValue = (v: number | string | undefined) => (v === undefined || !Number(v) ? "" : String(Number(v)));
  return (
    <SetupDialog
      title={a ? `${a.code} ${a.description}` : "Add agency"}
      subtitle={a ? `${people.toLocaleString()} ${people === 1 ? "employee is" : "employees are"} in this agency` : undefined}
      submitLabel={a ? "Save changes" : "Add agency"}
      pending={pending}
      error={error}
      onSubmit={onSubmit}
      onClose={onClose}
      danger={
        a ? (
          people > 0 ? (
            <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
              In use, so it cannot be deleted. Give it an inactive date instead.
            </span>
          ) : (
            <DeleteAction label="Delete agency" question="Delete this agency for good?" pending={pending} onDelete={() => onDelete(a.id)} />
          )
        ) : undefined
      }
    >
      <div className="grid gap-x-4 gap-y-3.5 [grid-template-columns:120px_minmax(0,1fr)]">
        <Input label="Number" name="code" type="number" min={0} step={1} required defaultValue={a ? String(a.code) : ""} placeholder="12" />
        <Input label="Name" name="description" required maxLength={255} defaultValue={a?.description ?? ""} placeholder="Bergen Staffing" />
      </div>
      <div className="grid gap-x-4 gap-y-3.5 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        <Input label="Labor rate" name="laborRate" type="number" min={0} step="0.000001" defaultValue={numberValue(a?.laborRate)} placeholder="0.00" />
        <Input label="Charge rate" name="chargeRate" type="number" min={0} step="0.000001" defaultValue={numberValue(a?.chargeRate)} placeholder="0.00" />
        <Input label="Max work hours" name="maxWorkHours" type="number" min={0} step="0.01" defaultValue={numberValue(a?.maxWorkHours)} placeholder="No limit" />
      </div>
      <Input
        label="Inactive from"
        name="inactiveOn"
        type="date"
        defaultValue={a?.inactiveOn ? format(parseUtcDate(a.inactiveOn), "yyyy-MM-dd") : ""}
        hint="Leave empty while people are still placed through it. From this day it is no longer offered for new hires."
      />
    </SetupDialog>
  );
}
