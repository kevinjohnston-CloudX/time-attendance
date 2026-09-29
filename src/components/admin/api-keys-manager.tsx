"use client";

import { useEffect, useRef, useState, useTransition, type CSSProperties, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { EllipsisVertical, KeyRound } from "lucide-react";
import { format } from "date-fns";
import { createApiKey, revokeApiKey, regenerateApiKey } from "@/actions/api-key.actions";
import { Badge, Banner, Button, ConfirmDialog, Input, Toast, useToast } from "@/components/ui";
import { CopyButton } from "@/components/admin/api-documentation";

/**
 * The API Keys panel from the Integrations handoff: the key list with a menu
 * on each live key, the New Key form, the Regenerate and Revoke confirms, and
 * the one-time reveal after the server makes a key.
 *
 * <p>Revoked keys stay in the list on purpose. A key that vanished on revoke
 * would leave no answer to "what was that key that stopped working on Tuesday",
 * which is the question somebody asks when an integration breaks. The Status
 * filter in the page's toolbar decides which of them show.
 */

export type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  isActive: boolean;
};

export type KeyFilter = "all" | "active" | "revoked";

const PANEL: CSSProperties = { background: "var(--surface-card)", borderRadius: 18, boxShadow: "var(--ta-shell-shadow)" };
const COLS = "[grid-template-columns:minmax(120px,1.6fr)_minmax(104px,1fr)_minmax(84px,.8fr)_minmax(72px,.8fr)_80px_32px]";
const MONO = "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)";

type Confirm = { kind: "revoke" | "regen"; id: string; name: string };

function RowMenu({ onRegenerate, onRevoke, disabled }: { onRegenerate: () => void; onRevoke: () => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const item = "ta-hoverable flex h-8 w-full items-center whitespace-nowrap px-2.5 text-left";
  return (
    <span className="relative flex justify-end">
      {open && <span className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Key actions"
        title="Key actions"
        className="ta-icon-btn h-[30px] w-[30px]"
        style={{ borderRadius: 8, color: "var(--icon-tertiary)", background: open ? "var(--fill-hover)" : undefined }}
      >
        <EllipsisVertical className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+4px)] z-50 w-[180px] p-1.5"
          style={{ borderRadius: 12, background: "var(--surface-card)", boxShadow: "var(--ta-menu-shadow)" }}
        >
          <button
            type="button"
            role="menuitem"
            className={item}
            style={{ border: 0, borderRadius: 8, background: "transparent", cursor: "pointer", font: "var(--type-body2)", color: "var(--text-primary)" }}
            onClick={() => { setOpen(false); onRegenerate(); }}
          >
            Regenerate
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            style={{ border: 0, borderRadius: 8, background: "transparent", cursor: "pointer", font: "var(--type-body2)", color: "var(--text-error)" }}
            onClick={() => { setOpen(false); onRevoke(); }}
          >
            Revoke
          </button>
        </div>
      )}
    </span>
  );
}

/** New Key: one field, named after what will hold the key. */
function NewKeyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string, key: string) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLFormElement>(null);
  const closeRef = useRef(onClose);
  const pendingRef = useRef(pending);
  useEffect(() => {
    closeRef.current = onClose;
    pendingRef.current = pending;
  }, [onClose, pending]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLInputElement>("input")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (!pendingRef.current) closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await createApiKey({ name: trimmed });
      if (!result.success) {
        setError(result.error);
        return;
      }
      onCreated(trimmed, result.data.fullKey);
    });
  };

  return (
    <div className="fixed inset-0 z-[58] flex items-start justify-center px-4 pb-4 pt-[18vh]">
      <div className="absolute inset-0" style={{ background: "var(--wms-overlay-modal)" }} onClick={() => !pending && onClose()} />
      <form
        ref={ref}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-key-title"
        className="ta-modal relative w-[520px] max-w-full px-[22px] pb-[18px] pt-5"
        style={{ borderRadius: 18 }}
      >
        <div className="mb-4 flex items-center gap-3">
          <span className="grid h-9 w-9 flex-none place-items-center" style={{ borderRadius: 10, background: "var(--surface-info)", color: "var(--icon-accent)" }}>
            <KeyRound className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <span className="flex flex-col gap-0.5">
            <span id="new-key-title" style={{ font: "var(--weight-semibold) 15px/20px var(--font-sans)", color: "var(--text-primary)" }}>
              New Key
            </span>
            <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>The key is generated on the server and shown to you once.</span>
          </span>
        </div>
        <Input
          label="Key name"
          required
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Timeclock 5903"
          hint="Name it after the thing that will hold it, not the person creating it."
        />
        {error && (
          <div className="mt-3">
            <Banner tone="error" title="The key was not created" body={error} />
          </div>
        )}
        <div className="mt-1 flex justify-end gap-2 pt-1">
          <Button type="button" hierarchy="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim() || pending}>
            {pending ? "Generating…" : "Generate"}
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Shown once, straight after the server generated the key. */
function RevealDialog({ name, fullKey, onClose }: { name: string; fullKey: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[data-done]")?.focus();
  }, []);
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4" style={{ background: "var(--wms-overlay-modal)" }}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reveal-title"
        className="ta-modal w-full max-w-[520px] px-[22px] pb-[18px] pt-[22px]"
        style={{ borderRadius: 18 }}
      >
        <div className="flex items-center gap-3">
          <span className="grid h-[42px] w-[42px] flex-none place-items-center" style={{ borderRadius: 12, background: "var(--surface-success)", color: "var(--icon-success)" }}>
            <KeyRound className="h-5 w-5" aria-hidden />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span id="reveal-title" style={{ font: "var(--type-h3)", color: "var(--text-primary)" }}>
              API key created
            </span>
            <span className="truncate" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
              {name}
            </span>
          </span>
        </div>
        <div className="mt-4">
          <Banner tone="warning" body="Copy this key now. Only its hash is stored, so closing this dialog is the last time anyone can read it." />
        </div>
        <div className="mt-3 flex items-center gap-2 py-2.5 pl-3.5 pr-2" style={{ borderRadius: 12, background: "var(--ta-code-bg)" }}>
          <code className="min-w-0 flex-1 break-all" style={{ fontFamily: MONO, fontSize: 12.5, lineHeight: 1.6, color: "var(--ta-code-fg)" }}>
            {fullKey}
          </code>
          <CopyButton text={fullKey} label="Copy" dark />
        </div>
        <div className="mt-[18px] flex justify-end">
          <Button data-done onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ApiKeysManager({
  apiKeys,
  filter,
  createOpen,
  onCreateOpenChange,
}: {
  apiKeys: ApiKey[];
  filter: KeyFilter;
  /** Driven by the "New Key" page action, which lives in IntegrationsClient. */
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ name: string; key: string } | null>(null);
  const { message, flash } = useToast();

  const active = apiKeys.filter((k) => k.isActive).length;
  const shown = apiKeys.filter((k) => filter === "all" || (filter === "active" ? k.isActive : !k.isActive));

  const doConfirm = () => {
    if (!confirm) return;
    const c = confirm;
    setConfirmError(null);
    startTransition(async () => {
      if (c.kind === "revoke") {
        const result = await revokeApiKey({ apiKeyId: c.id });
        if (!result.success) {
          setConfirmError(result.error);
          return;
        }
        setConfirm(null);
        flash(`"${c.name}" revoked. Anything using it has lost access.`);
      } else {
        const result = await regenerateApiKey({ apiKeyId: c.id });
        if (!result.success) {
          setConfirmError(result.error);
          return;
        }
        setConfirm(null);
        setReveal({ name: c.name, key: result.data.fullKey });
      }
      router.refresh();
    });
  };

  const footer =
    shown.length === apiKeys.length
      ? `${apiKeys.length} ${apiKeys.length === 1 ? "key" : "keys"}`
      : `${shown.length} of ${apiKeys.length} keys`;

  return (
    <>
      <section style={PANEL}>
        <div className="flex items-center gap-3 px-5 pb-3 pt-4">
          <span className="flex flex-1 flex-col gap-0.5">
            <span style={{ font: "var(--weight-semibold) 15px/20px var(--font-sans)", color: "var(--text-primary)" }}>API Keys</span>
            <span className="tabular" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
              {apiKeys.length === 0 ? "None yet" : `${active} active of ${apiKeys.length}`}
            </span>
          </span>
        </div>

        {apiKeys.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 px-6 pb-14 pt-12 text-center">
            <span
              className="grid h-[52px] w-[52px] place-items-center"
              style={{ borderRadius: 16, background: "var(--ta-well)", boxShadow: "inset 0 0 0 1px var(--ta-well-ring)", color: "var(--icon-disabled)" }}
            >
              <KeyRound className="h-[26px] w-[26px]" aria-hidden />
            </span>
            <span style={{ font: "var(--weight-semibold) 15px/22px var(--font-sans)", color: "var(--text-primary)" }}>No API keys yet</span>
            <span style={{ maxWidth: 380, font: "var(--type-body1)", color: "var(--text-secondary)" }}>
              A timeclock or an export needs a key before it can reach this company. Use New Key above.
            </span>
          </div>
        ) : (
          <div className="ta-scroll overflow-x-auto">
            <div className="min-w-[640px]">
              <div
                className={`mx-1.5 grid h-[38px] items-center gap-x-3 whitespace-nowrap px-3.5 ${COLS}`}
                style={{
                  borderRadius: 12,
                  background: "var(--ta-well)",
                  font: "var(--weight-semibold) 11px/14px var(--font-sans)",
                  letterSpacing: ".07em",
                  textTransform: "uppercase",
                  color: "var(--text-tertiary)",
                }}
              >
                <span>Key</span>
                <span>Prefix</span>
                <span>Created</span>
                <span>Last used</span>
                <span>Status</span>
                <span />
              </div>
              <div className="flex flex-col gap-0.5 px-1.5 py-1">
                {shown.map((k) => (
                  <div key={k.id} className={`ta-row-btn grid min-h-14 items-center gap-x-3 px-3.5 py-2 ${COLS}`} style={{ cursor: "default" }}>
                    <span className="flex min-w-0 items-center gap-3">
                      <span
                        className="grid h-[34px] w-[34px] flex-none place-items-center"
                        style={{
                          borderRadius: 10,
                          background: k.isActive ? "var(--surface-info)" : "var(--ta-well)",
                          color: k.isActive ? "var(--icon-accent)" : "var(--icon-disabled)",
                        }}
                      >
                        <KeyRound className="h-4 w-4" aria-hidden />
                      </span>
                      <span
                        className="min-w-0 truncate"
                        title={k.name}
                        style={{ font: "var(--weight-semibold) 14px/20px var(--font-sans)", color: k.isActive ? "var(--text-primary)" : "var(--text-tertiary)" }}
                      >
                        {k.name}
                      </span>
                    </span>
                    <span>
                      <code
                        className="inline-flex h-6 items-center whitespace-nowrap px-2"
                        style={{ borderRadius: 7, background: "var(--ta-well)", boxShadow: "inset 0 0 0 1px var(--ta-well-ring)", fontFamily: MONO, fontSize: 12, color: "var(--text-secondary)" }}
                      >
                        {k.keyPrefix}
                      </code>
                    </span>
                    <span className="tabular whitespace-nowrap" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                      {format(new Date(k.createdAt), "d MMM yyyy")}
                    </span>
                    <span className="tabular whitespace-nowrap" style={{ font: "var(--type-body2)", color: k.lastUsedAt ? "var(--text-secondary)" : "var(--text-tertiary)" }}>
                      {k.lastUsedAt ? format(new Date(k.lastUsedAt), "d MMM yyyy") : "Never"}
                    </span>
                    <span>
                      <Badge tone={k.isActive ? "success" : "error"} size="sm" dot>
                        {k.isActive ? "Active" : "Revoked"}
                      </Badge>
                    </span>
                    {k.isActive ? (
                      <RowMenu
                        disabled={pending}
                        onRegenerate={() => { setConfirmError(null); setConfirm({ kind: "regen", id: k.id, name: k.name }); }}
                        onRevoke={() => { setConfirmError(null); setConfirm({ kind: "revoke", id: k.id, name: k.name }); }}
                      />
                    ) : (
                      <span />
                    )}
                  </div>
                ))}
                {shown.length === 0 && (
                  <div className="px-4 py-7 text-center" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                    {filter === "revoked"
                      ? "No revoked keys. Revoked keys stay listed here so a broken integration can be traced."
                      : "No active keys. Anything that was using a key here has lost access."}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {apiKeys.length > 0 && (
          <div className="tabular mx-1.5 mb-1.5 flex items-center px-3.5 py-2.5" style={{ borderRadius: 12, background: "var(--ta-well)", font: "var(--type-body2)", color: "var(--text-secondary)" }}>
            {footer}
          </div>
        )}
      </section>

      {createOpen && (
        <NewKeyDialog
          onClose={() => onCreateOpenChange(false)}
          onCreated={(name, key) => {
            onCreateOpenChange(false);
            setReveal({ name, key });
            router.refresh();
          }}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === "revoke" ? "Revoke key?" : "Regenerate key?"}
          tone={confirm.kind === "revoke" ? "danger" : "warning"}
          confirmLabel={confirm.kind === "revoke" ? "Revoke" : "Regenerate"}
          pendingLabel={confirm.kind === "revoke" ? "Revoking…" : "Regenerating…"}
          pending={pending}
          error={confirmError}
          onConfirm={doConfirm}
          onCancel={() => setConfirm(null)}
        >
          {confirm.kind === "revoke"
            ? `Revoke key "${confirm.name}"? Any integration using it will immediately lose access.`
            : `Regenerate key "${confirm.name}"? The existing key will stop working immediately.`}
        </ConfirmDialog>
      )}

      {reveal && <RevealDialog name={reveal.name} fullKey={reveal.key} onClose={() => setReveal(null)} />}

      <Toast message={message} />
    </>
  );
}
