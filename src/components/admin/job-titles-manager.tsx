"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/components/layout/navigation-progress";
import { Briefcase, Plus } from "lucide-react";
import { createJobTitle, updateJobTitle, deleteJobTitle } from "@/actions/job-title.actions";
import { Button, EmptyState, Input, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import {
  AreaPanel,
  DeleteAction,
  Muted,
  SetupDialog,
  StatusBadge,
  StatusField,
  countLine,
  matches,
  saveError,
  useOpenFromLink,
  useStatusView,
} from "./setup/setup-ui";

/**
 * Job titles: the titles an employee record picks from, each with the code
 * payroll or HR knows it by (an ADP job code, a position number).
 *
 * <p>Built in Company Setup's language from John's Job Titles screen, which
 * had its own list and a page per form. The same fields and the same
 * permission (RULES_MANAGE); the edit happens in the area's window instead.
 * A title anyone still has cannot be deleted, since the database would
 * quietly clear it from them.
 */

interface JobTitle {
  id: string;
  name: string;
  externalId: string | null;
  isActive: boolean;
  _count?: { employees: number };
}

export function JobTitlesManager({ jobTitles }: { jobTitles: JobTitle[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<JobTitle | "new" | null>(null);
  const [query, setQuery] = useState("");
  const { view, setView, counts, kept } = useStatusView(jobTitles);
  const shown = kept.filter((j) => matches(query, j.name, j.externalId));

  function open(j: JobTitle | "new") {
    setEditing(j);
    setError(null);
  }
  function close() {
    setEditing(null);
    setError(null);
  }
  useOpenFromLink(jobTitles, open);

  function save(form: FormData) {
    const fields = {
      name: String(form.get("name") ?? "").trim(),
      externalId: String(form.get("externalId") ?? "").trim() || undefined,
    };
    setError(null);
    startTransition(async () => {
      const result =
        editing === "new"
          ? await createJobTitle(fields)
          : await updateJobTitle({ ...fields, id: (editing as JobTitle).id, isActive: form.get("isActive") === "true" });
      if (!result.success) return setError(saveError(result.error));
      close();
      router.refresh();
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteJobTitle({ id });
      if (!result.success) return setError(saveError(result.error));
      close();
      router.refresh();
    });
  }

  const addButton = (
    <Button onClick={() => open("new")} leadingIcon={<Plus className="h-4 w-4" />}>
      Add job title
    </Button>
  );

  return (
    <>
      <AreaPanel
        title="Job titles"
        hint="The titles an employee record picks from, each with the code payroll or HR uses for it."
        action={addButton}
        status={{ view, onChange: setView, counts }}
        search={jobTitles.length ? { value: query, onChange: setQuery, placeholder: "Title or code" } : undefined}
        count={countLine(shown.length, jobTitles.length, "job title", "job titles")}
      >
        {jobTitles.length === 0 ? (
          <EmptyState icon={<Briefcase className="h-8 w-8" />} title="No job titles yet" body="Add the first one, such as Warehouse Associate." action={addButton} />
        ) : shown.length === 0 ? (
          <EmptyState icon={<Briefcase className="h-8 w-8" />} title="No job titles match" body="Nothing matches that search or status." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Job title</TH>
                <TH>Code</TH>
                <TH numeric>Employees</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {shown.map((j) => {
                const people = j._count?.employees ?? 0;
                return (
                  <TR key={j.id} onClick={() => open(j)}>
                    <TD style={{ fontWeight: "var(--weight-medium)" }}>{j.name}</TD>
                    <TD style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>{j.externalId || <Muted />}</TD>
                    <TD numeric style={{ color: people ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                      {people.toLocaleString()}
                    </TD>
                    <TD>
                      <StatusBadge active={j.isActive} />
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </AreaPanel>

      {editing && (
        <JobTitleDialog jobTitle={editing === "new" ? null : editing} pending={isPending} error={error} onSubmit={save} onDelete={remove} onClose={close} />
      )}
    </>
  );
}

function JobTitleDialog({
  jobTitle: j,
  pending,
  error,
  onSubmit,
  onDelete,
  onClose,
}: {
  jobTitle: JobTitle | null;
  pending: boolean;
  error: string | null;
  onSubmit: (form: FormData) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const people = j?._count?.employees ?? 0;
  return (
    <SetupDialog
      title={j ? j.name : "Add job title"}
      subtitle={j ? `${people.toLocaleString()} ${people === 1 ? "employee has" : "employees have"} this job title` : undefined}
      submitLabel={j ? "Save changes" : "Add job title"}
      pending={pending}
      error={error}
      onSubmit={onSubmit}
      onClose={onClose}
      danger={
        j ? (
          people > 0 ? (
            <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
              In use, so it cannot be deleted. Set it to inactive instead.
            </span>
          ) : (
            <DeleteAction label="Delete job title" question="Delete this job title for good?" pending={pending} onDelete={() => onDelete(j.id)} />
          )
        ) : undefined
      }
    >
      <div className="grid gap-x-4 gap-y-3.5 [grid-template-columns:minmax(0,1fr)_160px]">
        <Input label="Name" name="name" required maxLength={255} defaultValue={j?.name ?? ""} placeholder="Warehouse Associate" />
        <Input label="Code" name="externalId" maxLength={100} defaultValue={j?.externalId ?? ""} placeholder="WA-100" hint="Optional" />
      </div>
      {j && <StatusField defaultActive={j.isActive} />}
    </SetupDialog>
  );
}
