"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/components/layout/navigation-progress";
import { Plus, Tag } from "lucide-react";
import { createPayType, updatePayType, deletePayType } from "@/actions/pay-type.actions";
import { Button, EmptyState, Input, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import {
  AreaPanel,
  ChoiceField,
  DeleteAction,
  Muted,
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
 * Pay types: how somebody is paid, such as Non Exempt or Exempt, by number.
 *
 * <p>It was the last area on the old card list, and it never showed an
 * error: the actions answer failure as a result, not a throw, and the form
 * only caught throws, so a duplicate number or a refused delete closed the
 * form as if it had worked. It reads the result now, like every other area.
 * A pay type anyone still has cannot be deleted.
 */

interface PayType {
  id: string;
  number: number;
  description: string | null;
  includeInEmployeeSetup: boolean;
  isActive: boolean;
  _count?: { employees: number };
}

export function PayTypesManager({ payTypes }: { payTypes: PayType[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PayType | "new" | null>(null);
  const [query, setQuery] = useState("");
  const { view, setView, counts, kept } = useStatusView(payTypes);
  const shown = kept.filter((p) => matches(query, p.number, p.description));

  function open(p: PayType | "new") {
    setEditing(p);
    setError(null);
  }
  // A link from elsewhere (an employee record, a classic address) opens its record.
  useOpenFromLink(payTypes, open);
  function close() {
    setEditing(null);
    setError(null);
  }

  function save(form: FormData) {
    const fields = {
      number: String(form.get("number") ?? ""),
      description: String(form.get("description") ?? "").trim() || undefined,
      includeInEmployeeSetup: form.get("includeInEmployeeSetup") === "true",
    };
    setError(null);
    startTransition(async () => {
      const result =
        editing === "new"
          ? await createPayType(fields)
          : await updatePayType({ ...fields, id: (editing as PayType).id, isActive: form.get("isActive") === "true" });
      if (!result.success) return setError(saveError(result.error));
      close();
      router.refresh();
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await deletePayType({ id });
      if (!result.success) return setError(saveError(result.error));
      close();
      router.refresh();
    });
  }

  const addButton = (
    <Button onClick={() => open("new")} leadingIcon={<Plus className="h-4 w-4" />}>
      Add pay type
    </Button>
  );

  return (
    <>
      <AreaPanel
        title="Pay types"
        hint="How people are paid, such as Non Exempt or Exempt, each with the number payroll knows it by."
        action={addButton}
        status={{ view, onChange: setView, counts }}
        search={payTypes.length ? { value: query, onChange: setQuery, placeholder: "Number or name" } : undefined}
        count={countLine(shown.length, payTypes.length, "pay type", "pay types")}
      >
        {payTypes.length === 0 ? (
          <EmptyState icon={<Tag className="h-8 w-8" />} title="No pay types yet" body="Add the first one, such as Non Exempt." action={addButton} />
        ) : shown.length === 0 ? (
          <EmptyState icon={<Tag className="h-8 w-8" />} title="No pay types match" body="Nothing matches that search or status." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH numeric>No.</TH>
                <TH>Pay type</TH>
                <TH>Employee record</TH>
                <TH numeric>Employees</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {shown.map((p) => {
                const people = p._count?.employees ?? 0;
                return (
                  <TR key={p.id} onClick={() => open(p)}>
                    <TD numeric style={{ fontWeight: "var(--weight-semibold)" }}>
                      {p.number}
                    </TD>
                    <TD style={{ fontWeight: "var(--weight-medium)" }}>{p.description || <Muted>No name</Muted>}</TD>
                    <TD style={{ color: "var(--text-secondary)" }}>{p.includeInEmployeeSetup ? "Offered" : <Muted>Not offered</Muted>}</TD>
                    <TD numeric style={{ color: people ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                      {people.toLocaleString()}
                    </TD>
                    <TD>
                      <StatusBadge active={p.isActive} />
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </AreaPanel>

      {editing && (
        <PayTypeDialog payType={editing === "new" ? null : editing} pending={isPending} error={error} onSubmit={save} onDelete={remove} onClose={close} />
      )}
    </>
  );
}

function PayTypeDialog({
  payType: p,
  pending,
  error,
  onSubmit,
  onDelete,
  onClose,
}: {
  payType: PayType | null;
  pending: boolean;
  error: string | null;
  onSubmit: (form: FormData) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const people = p?._count?.employees ?? 0;
  return (
    <SetupDialog
      title={p ? `${p.number} ${p.description ?? ""}`.trim() : "Add pay type"}
      subtitle={p ? `${people.toLocaleString()} ${people === 1 ? "employee has" : "employees have"} this pay type` : undefined}
      submitLabel={p ? "Save changes" : "Add pay type"}
      pending={pending}
      error={error}
      onSubmit={onSubmit}
      onClose={onClose}
      danger={
        p ? (
          people > 0 ? (
            <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
              In use, so it cannot be deleted. Set it to inactive instead.
            </span>
          ) : (
            <DeleteAction label="Delete pay type" question="Delete this pay type for good?" pending={pending} onDelete={() => onDelete(p.id)} />
          )
        ) : undefined
      }
    >
      <div className="grid gap-x-4 gap-y-3.5 [grid-template-columns:120px_minmax(0,1fr)]">
        <Input label="Number" name="number" type="number" min={1} max={9999} required defaultValue={p ? String(p.number) : ""} placeholder="3" />
        <Input label="Name" name="description" maxLength={255} defaultValue={p?.description ?? ""} placeholder="Non Exempt" />
      </div>
      <ChoiceField
        label="On the employee record"
        name="includeInEmployeeSetup"
        defaultValue={p?.includeInEmployeeSetup === false ? "false" : "true"}
        options={[
          { value: "true", label: "Offered" },
          { value: "false", label: "Not offered" },
        ]}
        hint="Whether this pay type can be picked when setting up an employee."
      />
      {p && <StatusField defaultActive={p.isActive} />}
    </SetupDialog>
  );
}
