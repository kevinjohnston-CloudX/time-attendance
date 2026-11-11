"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition, type CSSProperties, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Ban, CalendarClock, CalendarX, Check, Copy, EllipsisVertical, KeyRound, RefreshCw, Users, UserX } from "lucide-react";
import { MenuDivider, MenuItem, MenuPanel, useMenuDismiss } from "@/components/ui/menu";
import { format } from "date-fns";
import { createApiKey, revokeApiKey, regenerateApiKey, setApiKeyScopes } from "@/actions/api-key.actions";
import { SCOPE_LABEL } from "@/lib/api/scopes";
import { Badge, Banner, Button, ConfirmDialog, Input, Toast, useToast } from "@/components/ui";
import { CopyButton } from "@/components/admin/api-documentation";
import styles from "./integrations.module.css";
import { Window, WindowBlock, WindowCard } from "@/components/ui/window";

/**
 * The API Keys panel from the Integrations handoff: the key list with a menu
 * on each live key, the New Key form, the Regenerate and Revoke confirms, and
 * the one-time reveal after the server makes a key.
 *
 * <p>A key does only what it was given: time off requests, the employee
 * directory, or both. Each is chosen when the key is made, or allowed and
 * removed later from the key's menu, always after a confirm that says what it
 * opens. Time off was open to every key until the security audit (2026-11).
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
  scopes: string[];
};

export type KeyFilter = "all" | "active" | "revoked";

const PANEL: CSSProperties = { background: "var(--surface-card)", borderRadius: 18, boxShadow: "var(--ta-shell-shadow)" };
const COLS = "[grid-template-columns:minmax(120px,1.6fr)_minmax(104px,1fr)_minmax(84px,.8fr)_minmax(72px,.8fr)_80px_32px]";
const DIRECTORY = "people:read";
const TIME_OFF = "time-off:write";

/** What a key may do, in one line for its row. */
function accessLine(scopes: string[]): string {
  const timeOff = scopes.includes(TIME_OFF);
  const directory = scopes.includes(DIRECTORY);
  if (timeOff && directory) return "Time off and directory";
  if (timeOff) return "Time off only";
  if (directory) return "Directory only";
  return "No access";
}
const MONO = "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)";

type Confirm = {
  kind: "revoke" | "regen" | "allowDirectory" | "removeDirectory" | "allowTimeOff" | "removeTimeOff";
  id: string;
  name: string;
  scopes: string[];
};

function RowMenu({
  timeOff,
  onTimeOff,
  directory,
  onDirectory,
  onRegenerate,
  onRevoke,
  disabled,
}: {
  timeOff: boolean;
  onTimeOff: () => void;
  directory: boolean;
  onDirectory: () => void;
  onRegenerate: () => void;
  onRevoke: () => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useMenuDismiss(open, close, wrapRef);
  return (
    <span ref={wrapRef} className="relative flex justify-end">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Key actions"
        title="Key actions"
        className={`ta-icon-btn h-[30px] w-[30px] ${styles.menuButton}`}
        style={{ borderRadius: 8, color: "var(--icon-tertiary)", background: open ? "var(--fill-hover)" : undefined }}
      >
        <EllipsisVertical className="h-4 w-4" />
      </button>
      {open && (
        <MenuPanel role="menu" aria-label="Key actions" className={`absolute right-0 top-[calc(100%+4px)] z-50 w-[250px] ${styles.menu}`}>
          <MenuItem
            icon={timeOff ? <CalendarX /> : <CalendarClock />}
            onClick={() => { setOpen(false); onTimeOff(); }}
          >
            {timeOff ? "Remove time off requests" : "Allow time off requests"}
          </MenuItem>
          <MenuItem icon={directory ? <UserX /> : <Users />} onClick={() => { setOpen(false); onDirectory(); }}>
            {directory ? "Remove directory access" : "Allow directory access"}
          </MenuItem>
          <MenuItem icon={<RefreshCw />} onClick={() => { setOpen(false); onRegenerate(); }}>
            Regenerate
          </MenuItem>
          <MenuDivider />
          <MenuItem icon={<Ban />} tone="danger" onClick={() => { setOpen(false); onRevoke(); }}>
            Revoke
          </MenuItem>
        </MenuPanel>
      )}
    </span>
  );
}

/** New Key: one field, named after what will hold the key. */
function NewKeyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string, key: string) => void }) {
  const [name, setName] = useState("");
  const [timeOff, setTimeOff] = useState(false);
  const [directory, setDirectory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const nameRef = useRef<HTMLDivElement>(null);
  // The name, once the window has taken focus for itself.
  useEffect(() => {
    nameRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await createApiKey({ name: trimmed, scopes: [...(timeOff ? [TIME_OFF] : []), ...(directory ? [DIRECTORY] : [])] });
      if (!result.success) {
        setError(result.error);
        return;
      }
      onCreated(trimmed, result.data.fullKey);
    });
  };

  const scope = (on: boolean, set: (v: boolean) => void, icon: React.ReactNode, key: keyof typeof SCOPE_LABEL) => (
    <label className={styles.scopeChoice} data-on={on}>
      <input type="checkbox" checked={on} disabled={pending} onChange={(e) => set(e.target.checked)} className="sr-only" />
      <span className={styles.scopeIcon}>{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={styles.scopeTitle}>{SCOPE_LABEL[key].title}</span>
        <span className={styles.scopeBody}>{SCOPE_LABEL[key].line}</span>
      </span>
      <span className={styles.scopeMark} aria-hidden="true">
        {on && <Check />}
      </span>
    </label>
  );

  return (
    <Window
      icon={<KeyRound />}
      title="New API key"
      subtitle="It is generated on the server and shown to you once."
      size="sm"
      width={520}
      busy={pending}
      onClose={onClose}
      onSubmit={submit}
      actions={
        <>
          <Button type="button" hierarchy="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button pending={pending} type="submit" disabled={!name.trim() || (!timeOff && !directory) || pending}>
            {pending ? "Generating…" : "Generate key"}
          </Button>
        </>
      }
    >
      {error && <Banner tone="error" title="The key was not created" body={error} />}
      <WindowCard>
        <WindowBlock>
          <div ref={nameRef}>
            <Input
              label="Key name"
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="For example: Timeclock 5903"
              hint="Name it after the thing that will hold it, not the person creating it."
            />
          </div>
        </WindowBlock>
        <WindowBlock label="Access" note="A key can do only what is picked here. Pick at least one.">
          <div className="flex flex-col gap-1.5">
            {scope(timeOff, setTimeOff, <CalendarClock aria-hidden />, TIME_OFF)}
            {scope(directory, setDirectory, <Users aria-hidden />, DIRECTORY)}
          </div>
        </WindowBlock>
      </WindowCard>
    </Window>
  );
}

/** The phone's way to copy the key: a full size button beside Done. */
function CopyKeyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = () => {
    navigator.clipboard?.writeText(text).then(
      () => {
        setDone(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setDone(false), 1800);
      },
      () => {}
    );
  };
  return (
    <Button hierarchy="secondary" onClick={copy} leadingIcon={done ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}>
      {done ? "Copied" : "Copy key"}
    </Button>
  );
}

/** Shown once, straight after the server generated the key. */
function RevealDialog({ name, fullKey, onClose }: { name: string; fullKey: string; onClose: () => void }) {
  const doneId = useId();
  useEffect(() => {
    document.getElementById(doneId)?.focus({ preventScroll: true });
  }, [doneId]);
  return (
    <Window
      tone="success"
      icon={<KeyRound />}
      title="API key created"
      subtitle={name}
      size="sm"
      width={520}
      dismissible={false}
      onClose={onClose}
      foot="Only Done closes this window."
      actions={
        <>
          <span className="ta-phone-only">
            <CopyKeyButton text={fullKey} />
          </span>
          <Button id={doneId} onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <Banner tone="warning" body="Copy this key now. Only its hash is stored, so closing this window is the last time anyone can read it." />
      <WindowCard padded>
        <div className="flex items-center gap-2 py-2.5 pl-3.5 pr-2" style={{ borderRadius: 12, background: "var(--ta-code-bg)" }}>
          <code className="min-w-0 flex-1 break-all" style={{ fontFamily: MONO, fontSize: 12.5, lineHeight: 1.6, color: "var(--ta-code-fg)" }}>
            {fullKey}
          </code>
          <span className={styles.codeCopy}>
            <CopyButton text={fullKey} label="Copy" dark />
          </span>
        </div>
      </WindowCard>
    </Window>
  );
}

const CONFIRM_COPY: Record<Confirm["kind"], { title: string; tone: "danger" | "warning"; confirm: string; pending: string; body: string; hint?: string }> = {
  revoke: {
    title: "Revoke this key?",
    tone: "danger",
    confirm: "Revoke key",
    pending: "Revoking…",
    body: "Any integration using it loses access immediately.",
    hint: "This cannot be undone.",
  },
  regen: {
    title: "Regenerate this key?",
    tone: "warning",
    confirm: "Regenerate key",
    pending: "Regenerating…",
    body: "The current key stops working immediately. Anything using it needs the new one.",
  },
  allowDirectory: {
    title: "Allow directory access?",
    tone: "warning",
    confirm: "Allow access",
    pending: "Allowing…",
    body:
      "Anything holding this key will be able to read every employee in this company: names, usernames, work and personal emails, phone numbers, badge IDs, site, department and supervisor. Pay, address and date of birth are never included.",
  },
  removeDirectory: {
    title: "Remove directory access?",
    tone: "danger",
    confirm: "Remove access",
    pending: "Removing…",
    body: "This key stops reading the employee directory right away. Its other access is unchanged.",
  },
  allowTimeOff: {
    title: "Allow time off requests?",
    tone: "warning",
    confirm: "Allow requests",
    pending: "Allowing…",
    body:
      "Anything holding this key will be able to read this company's leave types and send a time off request for any employee. Each request waits for approval like any other.",
  },
  removeTimeOff: {
    title: "Remove time off requests?",
    tone: "danger",
    confirm: "Remove access",
    pending: "Removing…",
    body: "This key stops sending time off requests right away. Its other access is unchanged.",
  },
};

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
      } else if (c.kind === "allowDirectory" || c.kind === "removeDirectory" || c.kind === "allowTimeOff" || c.kind === "removeTimeOff") {
        const scope = c.kind.endsWith("Directory") ? DIRECTORY : TIME_OFF;
        const allow = c.kind.startsWith("allow");
        const scopes = allow ? [...c.scopes.filter((s) => s !== scope), scope] : c.scopes.filter((s) => s !== scope);
        const result = await setApiKeyScopes({ apiKeyId: c.id, scopes });
        if (!result.success) {
          setConfirmError(result.error);
          return;
        }
        setConfirm(null);
        const what = scope === DIRECTORY ? "read the employee directory" : "send time off requests";
        flash(allow ? `"${c.name}" can now ${what}.` : `"${c.name}" can no longer ${what}.`);
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
              A timeclock or an export needs a key before it can reach this company. Use New key above.
            </span>
          </div>
        ) : (
          <div className={`ta-scroll overflow-x-auto ${styles.scroller}`}>
            <div className="min-w-[640px]">
              <div
                className={`mx-1.5 grid h-[38px] items-center gap-x-3 whitespace-nowrap px-3.5 ${COLS} ${styles.listHead}`}
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
                  <div key={k.id} className={`ta-row-btn grid min-h-14 items-center gap-x-3 px-3.5 py-2 ${COLS} ${styles.row}`} style={{ cursor: "default" }}>
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
                      <span className="flex min-w-0 flex-col">
                        <span
                          className="min-w-0 truncate"
                          title={k.name}
                          style={{ font: "var(--weight-semibold) 14px/20px var(--font-sans)", color: k.isActive ? "var(--text-primary)" : "var(--text-tertiary)" }}
                        >
                          {k.name}
                        </span>
                        {/* What the key may do: only what it was given. */}
                        <span
                          className="min-w-0 truncate"
                          style={{
                            font: "var(--type-body2)",
                            color: k.scopes.length > 0 && k.isActive ? "var(--text-accent)" : "var(--text-tertiary)",
                          }}
                        >
                          {accessLine(k.scopes)}
                        </span>
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
                        timeOff={k.scopes.includes(TIME_OFF)}
                        onTimeOff={() => {
                          setConfirmError(null);
                          setConfirm({ kind: k.scopes.includes(TIME_OFF) ? "removeTimeOff" : "allowTimeOff", id: k.id, name: k.name, scopes: k.scopes });
                        }}
                        directory={k.scopes.includes(DIRECTORY)}
                        onDirectory={() => {
                          setConfirmError(null);
                          setConfirm({ kind: k.scopes.includes(DIRECTORY) ? "removeDirectory" : "allowDirectory", id: k.id, name: k.name, scopes: k.scopes });
                        }}
                        onRegenerate={() => { setConfirmError(null); setConfirm({ kind: "regen", id: k.id, name: k.name, scopes: k.scopes }); }}
                        onRevoke={() => { setConfirmError(null); setConfirm({ kind: "revoke", id: k.id, name: k.name, scopes: k.scopes }); }}
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
          title={CONFIRM_COPY[confirm.kind].title}
          subtitle={confirm.name}
          hint={CONFIRM_COPY[confirm.kind].hint}
          tone={CONFIRM_COPY[confirm.kind].tone}
          confirmLabel={CONFIRM_COPY[confirm.kind].confirm}
          pendingLabel={CONFIRM_COPY[confirm.kind].pending}
          pending={pending}
          error={confirmError}
          onConfirm={doConfirm}
          onCancel={() => setConfirm(null)}
        >
          {CONFIRM_COPY[confirm.kind].body}
        </ConfirmDialog>
      )}

      {reveal && <RevealDialog name={reveal.name} fullKey={reveal.key} onClose={() => setReveal(null)} />}

      <Toast message={message} />
    </>
  );
}
