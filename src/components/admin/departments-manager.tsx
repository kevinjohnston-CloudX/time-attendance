"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen, X } from "lucide-react";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { createDepartment, updateDepartment } from "@/actions/admin.actions";
import type { Site, Department } from "@prisma/client";
import {
  Badge,
  Banner,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Input,
  Select,
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
 * Departments, on the design's list template.
 *
 * <p>The design's Departments list carries Cost Centre, Manager, Default Shift
 * and a head count. A Department in this schema is a name, a set of sites and
 * an active flag — nothing else — so those four columns are left out rather
 * than filled in with placeholders.
 *
 * <p>A department with no site is the one row that matters here: employees are
 * scoped by site, so an unsited department is invisible to every supervisor.
 * It gets the tertiary "No sites" instead of an empty cell.
 */

type DepartmentWithSites = Department & { sites: { site: Site }[] };

interface Props {
  departments: DepartmentWithSites[];
  sites: Site[];
}

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

/**
 * Which sites a department exists at.
 *
 * <p>The kit's Checkbox is itself a label, so these are laid out as a plain
 * row rather than wrapped in bordered pills — a label inside a label toggles
 * twice on one click.
 */
function SiteCheckboxes({
  sites,
  selected,
  onChange,
}: {
  sites: Site[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }
  return (
    <div className="flex w-full flex-col gap-1.5">
      <span className="wms-label">Sites</span>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {sites.map((s) => (
          <Checkbox
            key={s.id}
            checked={selected.includes(s.id)}
            onChange={() => toggle(s.id)}
            label={s.name}
          />
        ))}
      </div>
    </div>
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

function FormActions({
  submitLabel,
  pending,
  onCancel,
}: {
  submitLabel: string;
  pending: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="mt-5 flex gap-2 pt-4" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
      <Button type="button" hierarchy="secondary" onClick={onCancel}>Cancel</Button>
    </div>
  );
}

export function DepartmentsManager({ departments, sites }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [editingDept, setEditingDept] = useState<DepartmentWithSites | null>(null);
  const [editSiteIds, setEditSiteIds] = useState<string[]>([]);

  const [showCreate, setShowCreate] = useState(false);
  const [createSiteIds, setCreateSiteIds] = useState<string[]>([]);

  function openEdit(dept: DepartmentWithSites) {
    setEditingDept(dept);
    setEditSiteIds(dept.sites.map((ds) => ds.site.id));
    setError(null);
  }

  function closeEdit() {
    setEditingDept(null);
    setEditSiteIds([]);
    setError(null);
  }

  function openCreate() {
    setShowCreate(true);
    setCreateSiteIds([]);
    setError(null);
  }

  function closeCreate() {
    setShowCreate(false);
    setCreateSiteIds([]);
    setError(null);
  }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (createSiteIds.length === 0) { setError("Select at least one site."); return; }
    setError(null);
    startTransition(async () => {
      const result = await createDepartment({ name: fd.get("name") as string, siteIds: createSiteIds });
      if (!result.success) { setError(result.error); return; }
      closeCreate();
      router.refresh();
    });
  }

  function handleUpdate(dept: DepartmentWithSites, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (editSiteIds.length === 0) { setError("Select at least one site."); return; }
    setError(null);
    startTransition(async () => {
      const result = await updateDepartment({
        departmentId: dept.id,
        name: fd.get("name") as string,
        siteIds: editSiteIds,
        isActive: fd.get("isActive") === "true",
      });
      if (!result.success) { setError(result.error); return; }
      closeEdit();
      router.refresh();
    });
  }

  return (
    <div className="mt-4 flex flex-col gap-2.5">
      <Toolbar count={departments.length} countLabel="department">
        <Button onClick={openCreate}>New Department</Button>
      </Toolbar>

      <Card padding={0}>
        {departments.length === 0 ? (
          <EmptyState
            icon={<FolderOpen className="h-8 w-8" />}
            title="No departments"
            body="Departments group employees inside a site and decide who a supervisor sees."
            action={<Button size="sm" onClick={openCreate}>New Department</Button>}
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Department</TH>
                  <TH>Sites</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {departments.map((dept) => (
                  <TR key={dept.id} onClick={() => openEdit(dept)}>
                    <TD style={{ fontWeight: "var(--weight-medium)" }}>{dept.name}</TD>
                    <TD style={{ color: "var(--text-secondary)" }}>
                      {dept.sites.length === 0 ? (
                        <span style={{ color: "var(--text-tertiary)" }}>No sites</span>
                      ) : (
                        dept.sites.map((ds) => ds.site.name).join(", ")
                      )}
                    </TD>
                    <TD>
                      {dept.isActive ? (
                        <Badge tone={statusTone("ACTIVE")} size="sm" dot>Active</Badge>
                      ) : (
                        // statusTone would answer "warning" here; an amber pill
                        // on a department nobody is in reads as something to
                        // action. Neutral is Badge's own default.
                        <Badge size="sm">Inactive</Badge>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <TableFooter
              shown={departments.length}
              total={departments.length}
              label={departments.length === 1 ? "department" : "departments"}
            />
          </>
        )}
      </Card>

      {showCreate && (
        <Modal title="New Department" onClose={closeCreate}>
          {error && <div className="mb-4"><Banner tone="error" body={error} /></div>}
          <form onSubmit={handleCreate}>
            <div className="flex flex-col gap-3">
              <div className={FIELD_GRID}>
                <Input label="Name" name="name" required placeholder="e.g. Operations" />
              </div>
              <SiteCheckboxes sites={sites} selected={createSiteIds} onChange={setCreateSiteIds} />
            </div>
            <FormActions submitLabel="Create" pending={isPending} onCancel={closeCreate} />
          </form>
        </Modal>
      )}

      {editingDept && (
        <Modal title={`Edit: ${editingDept.name}`} onClose={closeEdit}>
          {error && <div className="mb-4"><Banner tone="error" body={error} /></div>}
          <form onSubmit={(e) => handleUpdate(editingDept, e)}>
            <div className="flex flex-col gap-3">
              <div className={FIELD_GRID}>
                <Input label="Name" name="name" defaultValue={editingDept.name} required />
                <SelectField label="Status" name="isActive" defaultValue={editingDept.isActive ? "true" : "false"}>
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </SelectField>
              </div>
              <SiteCheckboxes sites={sites} selected={editSiteIds} onChange={setEditSiteIds} />
            </div>
            <FormActions submitLabel="Save changes" pending={isPending} onCancel={closeEdit} />
          </form>
        </Modal>
      )}
    </div>
  );
}
