"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, X } from "lucide-react";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { createReasonCode, updateReasonCode, deleteReasonCode } from "@/actions/reason-code.actions";
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
 * Reason codes, on the design's list template.
 *
 * <p>The design's Reason Codes list also carries Applies To, whether a note is
 * required, and who the code is visible to. None of the three exists on the
 * record, so the table is the three columns that do: the code, its label and
 * whether it is still offered.
 *
 * <p>The highlight colour stays on the code itself rather than becoming a
 * column of its own. It is chosen so a code is recognisable at a glance on a
 * timecard, and a swatch in a separate cell shows the colour without showing
 * what it does.
 */

type ReasonCodeItem = { id: string; code: string; label: string; color: string | null; isActive: boolean };
interface Props { reasonCodes: ReasonCodeItem[] }

type View = "all" | "active" | "inactive";

const VIEWS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

/** Field grid from the design's doc template, at three columns. */
const FIELD_GRID = "grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(200px,32%)),1fr))]";

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

/**
 * The code's highlight colour.
 *
 * <p>An empty value is a real state — most codes carry no colour — so the
 * swatch keeps a hidden input that submits "" rather than the picker's own
 * value, which is never blank.
 */
function ColorPicker({ name, defaultValue }: { name: string; defaultValue?: string | null }) {
  const [value, setValue] = useState(defaultValue ?? "");
  const hasColor = value !== "";
  return (
    <div className="flex w-full flex-col gap-1.5">
      <span className="wms-label">Highlight Color</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={hasColor ? value : "#6366f1"}
          onChange={(e) => setValue(e.target.value)}
          className="ta-field h-8 w-10 cursor-pointer rounded-md p-0.5"
          style={{ border: "1px solid var(--stroke-default)", background: "var(--surface-card)" }}
          title="Pick a color"
        />
        <input type="hidden" name={name} value={hasColor ? value : ""} />
        <Button
          type="button"
          hierarchy="link"
          size="sm"
          onClick={() => setValue(hasColor ? "" : "#6366f1")}
        >
          {hasColor ? "Clear" : "Set color"}
        </Button>
      </div>
    </div>
  );
}

/** The code as it appears on a timecard, tinted with its own colour. */
function CodeChip({ code, color }: { code: string; color: string | null }) {
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 text-center"
      style={{
        font: "var(--weight-semibold) 11px/16px var(--font-mono)",
        minWidth: 72,
        background: color ? `${color}33` : "var(--surface-tertiary)",
        color: color ?? "var(--text-secondary)",
        border: `1px solid ${color ? `${color}66` : "var(--stroke-secondary)"}`,
      }}
    >
      {code}
    </span>
  );
}

function ReasonCodeFields({ rc }: { rc?: ReasonCodeItem }) {
  return (
    <div className={FIELD_GRID}>
      <Input
        label="Code"
        name="code"
        required
        defaultValue={rc?.code ?? ""}
        placeholder="e.g. LATE"
        style={{ textTransform: "uppercase" }}
      />
      <Input label="Label" name="label" required defaultValue={rc?.label ?? ""} placeholder="e.g. Late Arrival" />
      <ColorPicker name="color" defaultValue={rc?.color} />
    </div>
  );
}

export function ReasonCodesManager({ reasonCodes }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingRc, setEditingRc] = useState<ReasonCodeItem | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [view, setView] = useState<View>("active");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const visible = reasonCodes.filter((rc) =>
    view === "all" ? true : view === "active" ? rc.isActive : !rc.isActive,
  );

  function openEdit(rc: ReasonCodeItem) { setEditingRc(rc); setConfirmDeleteId(null); setError(null); }
  function closeEdit() { setEditingRc(null); setConfirmDeleteId(null); setError(null); }
  function openCreate() { setShowCreate(true); setError(null); }
  function closeCreate() { setShowCreate(false); setError(null); }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await createReasonCode({ code: fd.get("code") as string, label: fd.get("label") as string, color: (fd.get("color") as string) || null });
      if (!result.success) { setError(result.error); return; }
      closeCreate();
      router.refresh();
    });
  }

  function handleUpdate(rc: ReasonCodeItem, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await updateReasonCode({
        reasonCodeId: rc.id,
        code: fd.get("code") as string,
        label: fd.get("label") as string,
        color: (fd.get("color") as string) || null,
        isActive: fd.get("isActive") === "true",
      });
      if (!result.success) { setError(result.error); return; }
      closeEdit();
      router.refresh();
    });
  }

  function handleDelete(reasonCodeId: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteReasonCode({ reasonCodeId });
      if (!result.success) { setError(result.error); setConfirmDeleteId(null); return; }
      setConfirmDeleteId(null);
      closeEdit();
      router.refresh();
    });
  }

  return (
    <div className="mt-4 flex flex-col gap-2.5">
      <Toolbar count={visible.length} countLabel="reason code">
        <SegmentedControl
          items={VIEWS}
          value={view}
          onChange={(v) => setView(v as View)}
          size="sm"
          ariaLabel="Which reason codes to show"
        />
        <Button onClick={openCreate}>New Reason Code</Button>
      </Toolbar>

      <Card padding={0}>
        {visible.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="h-8 w-8" />}
            title={view === "active" ? "No active reason codes" : view === "inactive" ? "No retired reason codes" : "No reason codes"}
            body="A reason code is what a supervisor picks when a punch is added or changed."
            action={<Button size="sm" onClick={openCreate}>New Reason Code</Button>}
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Code</TH>
                  <TH>Label</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {visible.map((rc) => (
                  <TR key={rc.id} onClick={() => openEdit(rc)}>
                    <TD><CodeChip code={rc.code} color={rc.color} /></TD>
                    <TD style={{ fontWeight: "var(--weight-medium)" }}>{rc.label}</TD>
                    <TD>
                      {rc.isActive ? (
                        <Badge tone={statusTone("ACTIVE")} size="sm" dot>Active</Badge>
                      ) : (
                        // statusTone would answer "warning"; a retired code is
                        // not a warning, it is simply no longer offered.
                        <Badge size="sm">Inactive</Badge>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <TableFooter
              shown={visible.length}
              total={reasonCodes.length}
              label={reasonCodes.length === 1 ? "reason code" : "reason codes"}
            />
          </>
        )}
      </Card>

      {showCreate && (
        <Modal title="New Reason Code" onClose={closeCreate}>
          {error && <div className="mb-4"><Banner tone="error" body={error} /></div>}
          <form onSubmit={handleCreate}>
            <ReasonCodeFields />
            <div className="mt-5 flex gap-2 pt-4" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
              <Button type="submit" disabled={isPending}>{isPending ? "Creating…" : "Create"}</Button>
              <Button type="button" hierarchy="secondary" onClick={closeCreate}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}

      {editingRc && (
        <Modal title={`Edit: ${editingRc.code} — ${editingRc.label}`} onClose={closeEdit}>
          {error && <div className="mb-4"><Banner tone="error" body={error} /></div>}
          <form onSubmit={(e) => handleUpdate(editingRc, e)}>
            <ReasonCodeFields rc={editingRc} />
            <div className={`mt-3 ${FIELD_GRID}`}>
              <SelectField label="Status" name="isActive" defaultValue={editingRc.isActive ? "true" : "false"}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </SelectField>
            </div>
            <div
              className="mt-5 flex flex-wrap items-center justify-between gap-3 pt-4"
              style={{ borderTop: "1px solid var(--stroke-divider)" }}
            >
              <div className="flex gap-2">
                <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Save changes"}</Button>
                <Button type="button" hierarchy="secondary" onClick={closeEdit}>Cancel</Button>
              </div>
              {confirmDeleteId === editingRc.id ? (
                <div className="flex items-center gap-2">
                  <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>Are you sure?</span>
                  <Button type="button" tone="error" size="sm" onClick={() => handleDelete(editingRc.id)} disabled={isPending}>
                    {isPending ? "Deleting…" : "Yes, delete"}
                  </Button>
                  <Button type="button" hierarchy="secondary" size="sm" onClick={() => setConfirmDeleteId(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button type="button" hierarchy="link" tone="error" size="sm" onClick={() => setConfirmDeleteId(editingRc.id)}>
                  Delete code
                </Button>
              )}
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
