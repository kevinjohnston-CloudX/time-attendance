"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "@/components/layout/navigation-progress";
import { MessageSquare, Plus } from "lucide-react";
import { createReasonCode, updateReasonCode, deleteReasonCode } from "@/actions/reason-code.actions";
import { Button, EmptyState, Input, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import {
  AreaPanel,
  DeleteAction,
  FIELD_GRID,
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
 * Reason codes: what a supervisor picks for a timecard day, such as Late
 * arrival or Training.
 *
 * <p>A code may carry a highlight colour, which tints that day's reason
 * cell on the timecard. The colour is the admin's own pick, stored as a
 * hex value, so the list previews it exactly the way the timecard draws it:
 * the same faint tint behind ordinary text, readable in light and dark.
 *
 * <p>A code already on a timecard day cannot be deleted; the window says
 * so up front and offers inactive instead.
 */

type ReasonCodeItem = {
  id: string;
  code: string;
  label: string;
  color: string | null;
  isActive: boolean;
  _count?: { dayReasons: number };
};

/** The tint the timecard puts behind a coloured reason: the colour at 20%. */
const tint = (color: string | null) => (color ? `${color}33` : "var(--fill-hover)");

/** The code as it looks on a timecard. */
function CodeChip({ code, color }: { code: string; color: string | null }) {
  return (
    <span
      className="inline-flex h-6 items-center whitespace-nowrap rounded-md px-2"
      style={{
        font: "var(--type-caption1)",
        fontFamily: "var(--font-mono)",
        fontWeight: "var(--weight-semibold)",
        color: "var(--text-primary)",
        background: tint(color),
        border: "1px solid var(--stroke-divider)",
      }}
    >
      {code}
    </span>
  );
}

/**
 * A design token as a hex value, for the colour picker's starting point.
 * The picker only takes #rrggbb, so the token is painted once and read back.
 */
function tokenHex(token: string): string {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    const css = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    if (!ctx || !css) return "#000000";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return "#000000";
  }
}

export function ReasonCodesManager({ reasonCodes }: { reasonCodes: ReasonCodeItem[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ReasonCodeItem | "new" | null>(null);
  const [query, setQuery] = useState("");
  const { view, setView, counts, kept } = useStatusView(reasonCodes);
  const shown = kept.filter((rc) => matches(query, rc.code, rc.label));

  function open(rc: ReasonCodeItem | "new") {
    setEditing(rc);
    setError(null);
  }
  // A link from elsewhere (an employee record, a classic address) opens its record.
  useOpenFromLink(reasonCodes, open);
  function close() {
    setEditing(null);
    setError(null);
  }

  function save(form: FormData) {
    const fields = {
      code: String(form.get("code") ?? "").trim(),
      label: String(form.get("label") ?? "").trim(),
      color: String(form.get("color") ?? "") || null,
    };
    setError(null);
    startTransition(async () => {
      const result =
        editing === "new"
          ? await createReasonCode(fields)
          : await updateReasonCode({ ...fields, reasonCodeId: (editing as ReasonCodeItem).id, isActive: form.get("isActive") === "true" });
      if (!result.success) return setError(saveError(result.error));
      close();
      router.refresh();
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteReasonCode({ reasonCodeId: id });
      if (!result.success) return setError(saveError(result.error));
      close();
      router.refresh();
    });
  }

  const addButton = (
    <Button onClick={() => open("new")} leadingIcon={<Plus className="h-4 w-4" />}>
      Add reason code
    </Button>
  );

  return (
    <>
      <AreaPanel
        title="Reason codes"
        hint="What a supervisor picks for a timecard day, such as a late arrival or training."
        action={addButton}
        status={{ view, onChange: setView, counts }}
        search={reasonCodes.length ? { value: query, onChange: setQuery, placeholder: "Code or name" } : undefined}
        count={countLine(shown.length, reasonCodes.length, "reason code", "reason codes")}
      >
        {reasonCodes.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="h-8 w-8" />}
            title="No reason codes yet"
            body="Add the first one, such as LATE for a late arrival."
            action={addButton}
          />
        ) : shown.length === 0 ? (
          <EmptyState icon={<MessageSquare className="h-8 w-8" />} title="No reason codes match" body="Nothing matches that search or status." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH style={{ width: 160 }}>Code</TH>
                <TH>Reason</TH>
                <TH numeric>Timecard days</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {shown.map((rc) => {
                const used = rc._count?.dayReasons ?? 0;
                return (
                  <TR key={rc.id} onClick={() => open(rc)}>
                    <TD>
                      <CodeChip code={rc.code} color={rc.color} />
                    </TD>
                    <TD style={{ fontWeight: "var(--weight-medium)" }}>{rc.label}</TD>
                    <TD numeric style={{ color: used ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                      {used.toLocaleString()}
                    </TD>
                    <TD>
                      <StatusBadge active={rc.isActive} />
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </AreaPanel>

      {editing && (
        <ReasonCodeDialog
          reasonCode={editing === "new" ? null : editing}
          pending={isPending}
          error={error}
          onSubmit={save}
          onDelete={remove}
          onClose={close}
        />
      )}
    </>
  );
}

function ReasonCodeDialog({
  reasonCode: rc,
  pending,
  error,
  onSubmit,
  onDelete,
  onClose,
}: {
  reasonCode: ReasonCodeItem | null;
  pending: boolean;
  error: string | null;
  onSubmit: (form: FormData) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState(rc?.code ?? "");
  const [color, setColor] = useState(rc?.color ?? "");
  const picker = useRef<HTMLInputElement>(null);
  const used = rc?._count?.dayReasons ?? 0;

  function pickColor() {
    if (!color) setColor(tokenHex("--icon-accent"));
    // Open the system picker straight away rather than make it a second click.
    requestAnimationFrame(() => {
      const el = picker.current;
      if (!el) return;
      if (typeof el.showPicker === "function") el.showPicker();
      else el.click();
    });
  }

  return (
    <SetupDialog
      title={rc ? `${rc.code} ${rc.label}` : "Add reason code"}
      subtitle={rc ? `On ${used.toLocaleString()} timecard ${used === 1 ? "day" : "days"}` : undefined}
      submitLabel={rc ? "Save changes" : "Add reason code"}
      pending={pending}
      error={error}
      onSubmit={onSubmit}
      onClose={onClose}
      danger={
        rc ? (
          used > 0 ? (
            <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
              In use, so it cannot be deleted. Set it to inactive instead.
            </span>
          ) : (
            <DeleteAction label="Delete reason code" question="Delete this reason code for good?" pending={pending} onDelete={() => onDelete(rc.id)} />
          )
        ) : undefined
      }
    >
      <div className="grid gap-x-4 gap-y-3.5 [grid-template-columns:160px_minmax(0,1fr)]">
        <Input
          label="Code"
          name="code"
          required
          maxLength={20}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="LATE"
          style={{ fontFamily: "var(--font-mono)" }}
        />
        <Input label="Name" name="label" required maxLength={100} defaultValue={rc?.label ?? ""} placeholder="Late arrival" />
      </div>

      <div className={FIELD_GRID}>
        <div className="flex min-w-0 flex-col items-start gap-1.5">
          <span className="wms-label">Highlight</span>
          <span className="flex h-9 items-center gap-3">
            <CodeChip code={code || "CODE"} color={color || null} />
            <input
              ref={picker}
              type="color"
              value={color || "#000000"}
              onChange={(e) => setColor(e.target.value)}
              aria-label="Highlight color"
              className="sr-only"
              tabIndex={-1}
            />
            <Button type="button" hierarchy="link" size="sm" onClick={pickColor}>
              {color ? "Change color" : "Add a color"}
            </Button>
            {color && (
              <Button type="button" hierarchy="link" size="sm" onClick={() => setColor("")}>
                Remove
              </Button>
            )}
          </span>
          <input type="hidden" name="color" value={color} />
          <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)", textWrap: "pretty" }}>
            Optional. Tints the day on the timecard so this reason stands out.
          </span>
        </div>
        {rc && <StatusField defaultActive={rc.isActive} />}
      </div>
    </SetupDialog>
  );
}
