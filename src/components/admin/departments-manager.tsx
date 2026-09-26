"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/components/layout/navigation-progress";
import { FolderOpen, Plus } from "lucide-react";
import type { Department, Site } from "@prisma/client";
import { createDepartment, updateDepartment } from "@/actions/admin.actions";
import { Badge, Button, EmptyState, FilterSelectChip, Input, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import {
  AreaPanel,
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
 * Departments: the groups people work in, and the sites each one exists at.
 *
 * <p>A department with no site is the row that matters here: employees are
 * scoped by site, so an unsited department is invisible to every supervisor.
 * It says No sites in the row rather than leaving the cell empty. New and
 * edited departments need at least one site, here and on the server.
 */

type DepartmentWithSites = Department & { sites: { site: Site }[] };

/** Up to this many sites are named in a row; more read as a count, named on hover. */
const SITES_SHOWN = 3;

export function DepartmentsManager({ departments, sites }: { departments: DepartmentWithSites[]; sites: Site[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<DepartmentWithSites | "new" | null>(null);
  const [query, setQuery] = useState("");
  const [siteId, setSiteId] = useState("");
  const { view, setView, counts, kept } = useStatusView(departments);
  const shown = kept.filter(
    (d) =>
      (!siteId || d.sites.some((s) => s.site.id === siteId)) &&
      matches(query, d.name, ...d.sites.map((s) => s.site.name)),
  );

  function open(d: DepartmentWithSites | "new") {
    setEditing(d);
    setError(null);
  }
  function close() {
    setEditing(null);
    setError(null);
  }

  function save(form: FormData, siteIds: string[]) {
    const name = String(form.get("name") ?? "").trim();
    setError(null);
    startTransition(async () => {
      const result =
        editing === "new"
          ? await createDepartment({ name, siteIds })
          : await updateDepartment({
              departmentId: (editing as DepartmentWithSites).id,
              name,
              siteIds,
              isActive: form.get("isActive") === "true",
            });
      if (!result.success) return setError(saveError(result.error));
      close();
      router.refresh();
    });
  }

  const addButton = (
    <Button onClick={() => open("new")} leadingIcon={<Plus className="h-4 w-4" />}>
      Add department
    </Button>
  );

  return (
    <>
      <AreaPanel
        title="Departments"
        hint="The groups people work in, and the sites each one exists at. Supervisors see people by department."
        action={addButton}
        status={{ view, onChange: setView, counts }}
        search={departments.length ? { value: query, onChange: setQuery, placeholder: "Department or site" } : undefined}
        filters={
          sites.length > 1 && departments.length ? (
            <FilterSelectChip
              label="Site"
              allLabel="Every site"
              value={siteId}
              options={sites.map((s) => ({ id: s.id, name: s.name }))}
              onChange={setSiteId}
            />
          ) : undefined
        }
        count={countLine(shown.length, departments.length, "department", "departments")}
      >
        {departments.length === 0 ? (
          <EmptyState
            icon={<FolderOpen className="h-8 w-8" />}
            title="No departments yet"
            body="Add the first one and pick the sites it exists at."
            action={addButton}
          />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<FolderOpen className="h-8 w-8" />}
            title="No departments match"
            body="Nothing matches that search, site or status."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Department</TH>
                <TH>Sites</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {shown.map((d) => {
                const names = d.sites.map((s) => s.site.name).sort((a, b) => a.localeCompare(b));
                return (
                  <TR key={d.id} onClick={() => open(d)}>
                    <TD style={{ fontWeight: "var(--weight-medium)" }}>{d.name}</TD>
                    <TD>
                      {names.length === 0 ? (
                        <Badge tone="warning" size="sm">
                          No sites
                        </Badge>
                      ) : names.length >= sites.length && sites.length > 1 ? (
                        <span style={{ color: "var(--text-secondary)" }}>Every site</span>
                      ) : names.length <= SITES_SHOWN ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          {names.map((n) => (
                            <Badge key={n} size="sm">
                              {n}
                            </Badge>
                          ))}
                        </span>
                      ) : (
                        <span title={names.join(", ")} style={{ color: "var(--text-secondary)" }}>
                          {names.length} sites
                        </span>
                      )}
                    </TD>
                    <TD>
                      <StatusBadge active={d.isActive} />
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </AreaPanel>

      {editing && (
        <DepartmentDialog
          department={editing === "new" ? null : editing}
          sites={sites}
          pending={isPending}
          error={error}
          onSubmit={save}
          onClose={close}
        />
      )}
    </>
  );
}

function DepartmentDialog({
  department,
  sites,
  pending,
  error,
  onSubmit,
  onClose,
}: {
  department: DepartmentWithSites | null;
  sites: Site[];
  pending: boolean;
  error: string | null;
  onSubmit: (form: FormData, siteIds: string[]) => void;
  onClose: () => void;
}) {
  const [siteIds, setSiteIds] = useState<string[]>(() => department?.sites.map((s) => s.site.id) ?? []);
  const [tried, setTried] = useState(false);
  const missing = siteIds.length === 0;

  return (
    <SetupDialog
      title={department ? department.name : "Add department"}
      subtitle={department ? "Edit department" : undefined}
      submitLabel={department ? "Save changes" : "Add department"}
      pending={pending}
      error={error}
      onSubmit={(form) => {
        setTried(true);
        if (!missing) onSubmit(form, siteIds);
      }}
      onClose={onClose}
    >
      <Input label="Name" name="name" required defaultValue={department?.name ?? ""} placeholder="Operations" />
      <PickList
        label="Sites"
        items={sites.map((s) => ({ id: s.id, label: s.name, note: s.isActive ? undefined : "Inactive" }))}
        selected={siteIds}
        onChange={setSiteIds}
        searchPlaceholder="Find a site"
        invalid={tried && missing}
        hint={tried && missing ? "Pick at least one site." : "The sites this department exists at."}
      />
      {department && <StatusField defaultActive={department.isActive} />}
    </SetupDialog>
  );
}
