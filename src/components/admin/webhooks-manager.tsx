"use client";

import { useEffect, useRef, useState, useTransition, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleCheck, CircleX, EllipsisVertical, UserCheck, UserX, Webhook, X } from "lucide-react";
import { format, isToday } from "date-fns";
import {
  createWebhook,
  listWebhookDeliveries,
  removeWebhook,
  rotateWebhookSecret,
  sendWebhookTest,
  setWebhookActive,
} from "@/actions/webhook.actions";
import { EVENT_LABEL, TEST_EVENT, WEBHOOK_EVENTS, eventsSummary, type WebhookEvent } from "@/lib/webhooks/events";
import { Badge, Banner, Button, ConfirmDialog, Input, Toast, useToast } from "@/components/ui";
import { Overlay } from "@/components/ui/overlay";
import { CopyButton } from "@/components/admin/api-documentation";
import styles from "./webhooks.module.css";

/**
 * The Webhooks view on Integrations: one row per endpoint, with Send test,
 * Deliveries, Pause or Resume, New secret and Remove on each, and the New
 * Webhook window behind the page action. Its windows follow the Export window
 * on Live Attendance.
 *
 * <p>The secret is shown once, when the endpoint is made or given a new one.
 * CloudTime keeps no copy (see src/lib/webhooks/signing), so the window says
 * plainly that closing it is the last chance to read it.
 */

export type WebhookRow = {
  id: string;
  name: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: Date;
  /** Whether this copy of CloudTime sends this endpoint's messages. */
  sendsHere: boolean;
  last: { ok: boolean; statusCode: number | null; attemptedAt: Date; event: string } | null;
};

type Attempt = { id: string; event: string; attempt: number; ok: boolean; statusCode: number | null; response: string | null; durationMs: number | null; attemptedAt: Date };
type Confirm = { kind: "pause" | "secret" | "remove"; id: string; name: string };

const PANEL: CSSProperties = { background: "var(--surface-card)", borderRadius: 18, boxShadow: "var(--ta-shell-shadow)" };
const EVENT_ICON: Record<WebhookEvent, ReactNode> = { "employee.terminated": <UserX />, "employee.reactivated": <UserCheck /> };

/** "Today, 2:14 PM" or "Oct 27, 2:14 PM". */
const when = (d: Date) => (isToday(d) ? `Today, ${format(d, "h:mm a")}` : format(d, "MMM d, h:mm a"));
const eventTitle = (e: string) => (e === TEST_EVENT ? "Test" : (EVENT_LABEL[e as WebhookEvent]?.title ?? e));

/** What came back, in a line: "Answered 200 in 120 ms" or the reason it was not reached. */
function outcome(a: { ok: boolean; statusCode: number | null; response: string | null; durationMs: number | null }): string {
  const ms = a.durationMs != null ? ` in ${a.durationMs.toLocaleString("en-US")} ms` : "";
  if (a.statusCode) return `Answered ${a.statusCode}${ms}${!a.ok && a.response ? `: ${a.response}` : ""}`;
  return a.response ?? "Not reached";
}

/** The grey frame every window here shares, from the Export window. */
function Frame({
  title,
  subtitle,
  icon,
  wide,
  foot,
  onClose,
  busy,
  children,
  as = "div",
  onSubmit,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  wide?: boolean;
  foot: ReactNode;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
  as?: "div" | "form";
  onSubmit?: (e: FormEvent) => void;
}) {
  const ref = useRef<HTMLDivElement & HTMLFormElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => {
    closeRef.current = onClose;
    busyRef.current = busy;
  }, [onClose, busy]);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    (ref.current?.querySelector<HTMLElement>("input, [data-autofocus]") ?? ref.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (!busyRef.current) closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, []);
  const Tag = as;
  return (
    <Overlay className={`${styles.scrim} ta-sheet-scrim`} onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <Tag
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="webhook-window-title"
        className={`${styles.window} ${wide ? styles.wide : ""} ta-sheet`}
        onSubmit={onSubmit}
      >
        <header className={styles.head}>
          <span className={styles.glyph} aria-hidden="true">
            {icon}
          </span>
          <span className={styles.titles}>
            <h2 id="webhook-window-title" className={styles.title}>
              {title}
            </h2>
            <span className={styles.subtitle}>{subtitle}</span>
          </span>
          <Button type="button" hierarchy="tertiary" size="sm" iconOnly onClick={onClose} disabled={busy} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className={`ta-scroll ${styles.body}`}>{children}</div>
        <footer className={styles.foot}>{foot}</footer>
      </Tag>
    </Overlay>
  );
}

function NewWebhookWindow({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string, secret: string) => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>([...WEBHOOK_EVENTS]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = name.trim() && url.trim() && events.length > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await createWebhook({ name: name.trim(), url: url.trim(), events });
      if (!result.success) return setError(result.error);
      onCreated(name.trim(), result.data.secret);
    });
  };

  return (
    <Frame
      as="form"
      onSubmit={submit}
      title="New Webhook"
      subtitle="Another system is told the moment it happens."
      icon={<Webhook />}
      busy={pending}
      onClose={onClose}
      foot={
        <>
          <span className={styles.footHint}>Its secret is shown once, after you create it.</span>
          <Button type="button" hierarchy="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={!ready || pending}>
            {pending ? "Creating…" : "Create webhook"}
          </Button>
        </>
      }
    >
      <section className={styles.card}>
        <div className={styles.block}>
          <Input
            label="Name"
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. CXT contacts"
            hint="Name it after the system that receives it."
          />
          <Input
            label="Address"
            required
            type="url"
            inputMode="url"
            maxLength={2000}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
            hint="The web address the other system gave you."
          />
        </div>
        <div className={styles.block}>
          <span className={styles.groupLabel} id="webhook-events">
            Send
          </span>
          <div className={styles.choices} role="group" aria-labelledby="webhook-events">
            {WEBHOOK_EVENTS.map((ev) => {
              const on = events.includes(ev);
              return (
                <label key={ev} className={styles.choice} data-on={on}>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={on}
                    disabled={pending}
                    onChange={(e) => setEvents((cur) => WEBHOOK_EVENTS.filter((x) => (x === ev ? e.target.checked : cur.includes(x))))}
                  />
                  <span className={styles.choiceIcon} aria-hidden="true">
                    {EVENT_ICON[ev]}
                  </span>
                  <span className={styles.choiceText}>
                    <span className={styles.choiceTitle}>{EVENT_LABEL[ev].title}</span>
                    <span className={styles.choiceBody}>{EVENT_LABEL[ev].line}</span>
                  </span>
                  <span className={styles.mark} aria-hidden="true">
                    {on && <Check />}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </section>
      {error && <Banner tone="error" title="The webhook was not created" body={error} />}
    </Frame>
  );
}

/** Shown once: straight after the endpoint is made, or after New secret. */
function SecretWindow({ title, name, secret, onClose }: { title: string; name: string; secret: string; onClose: () => void }) {
  return (
    <Frame
      title={title}
      subtitle={name}
      icon={<Webhook />}
      onClose={onClose}
      foot={
        <>
          <span className={styles.footHint}>The receiver uses it to check each message came from CloudTime.</span>
          <Button data-autofocus onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <section className={styles.card}>
        <div className={styles.block}>
          <Banner tone="warning" body="Copy this secret now and give it to the receiving system. CloudTime keeps no copy, so closing this window is the last time anyone can read it." />
          <div className={styles.code}>
            <code>{secret}</code>
            <CopyButton text={secret} label="Copy" dark />
          </div>
        </div>
      </section>
    </Frame>
  );
}

/** The latest attempts, and a test sent from here. */
function DeliveriesWindow({ hook, testFirst, onClose }: { hook: WebhookRow; testFirst: boolean; onClose: () => void }) {
  const router = useRouter();
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [test, setTest] = useState<{ ok: boolean; held: boolean; text: string } | null>(null);
  const [testing, startTest] = useTransition();
  const started = useRef(false);

  const load = async () => {
    const r = await listWebhookDeliveries({ id: hook.id });
    if (r.success) {
      setAttempts(r.data);
      setLoadError(null);
    } else setLoadError(r.error);
  };

  const runTest = () =>
    startTest(async () => {
      const r = await sendWebhookTest({ id: hook.id });
      if (!r.success) setTest({ ok: false, held: false, text: r.error });
      else setTest({ ok: r.data.ok, held: r.data.held, text: outcome(r.data) });
      await load();
      router.refresh();
    });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (testFirst) runTest();
    else void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, []);

  return (
    <Frame
      wide
      title="Deliveries"
      subtitle={hook.name}
      icon={<Webhook />}
      onClose={onClose}
      foot={
        <>
          <span className={styles.footHint}>The latest 25 attempts, newest first.</span>
          <Button hierarchy="secondary" onClick={runTest} disabled={testing}>
            {testing ? "Sending…" : "Send test"}
          </Button>
          <Button data-autofocus onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {test && (
        <Banner
          tone={test.ok ? "success" : test.held ? "info" : "error"}
          title={test.ok ? "Test delivered" : test.held ? "Test not sent from here" : "Test not delivered"}
          body={test.text}
        />
      )}
      {loadError && <Banner tone="error" title="Could not load the deliveries" body={loadError} />}
      <section className={styles.card} aria-label="Deliveries">
        {attempts === null ? (
          <div className={styles.empty}>{testing ? "Sending a test…" : "Loading…"}</div>
        ) : attempts.length === 0 ? (
          <div className={styles.empty}>Nothing sent yet. Use Send test to try the address.</div>
        ) : (
          <div className={styles.attempts}>
            {attempts.map((a) => (
              <div key={a.id} className={styles.attempt}>
                <span className={styles.attemptIcon} data-ok={a.ok} aria-label={a.ok ? "Delivered" : "Failed"}>
                  {a.ok ? <CircleCheck /> : <CircleX />}
                </span>
                <span className={styles.attemptText}>
                  <span className={styles.attemptTitle}>
                    {eventTitle(a.event)}
                    {a.attempt > 1 ? `, try ${a.attempt}` : ""}
                  </span>
                  <span className={styles.attemptBody} title={a.response ?? undefined}>
                    {outcome(a)}
                  </span>
                </span>
                <span className={styles.attemptWhen}>{when(new Date(a.attemptedAt))}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </Frame>
  );
}

function RowMenu({
  hook,
  disabled,
  onTest,
  onDeliveries,
  onPause,
  onResume,
  onSecret,
  onRemove,
}: {
  hook: WebhookRow;
  disabled: boolean;
  onTest: () => void;
  onDeliveries: () => void;
  onPause: () => void;
  onResume: () => void;
  onSecret: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const items: { label: string; danger?: boolean; run: () => void }[] = [
    { label: "Send test", run: onTest },
    { label: "Deliveries", run: onDeliveries },
    hook.isActive ? { label: "Pause", run: onPause } : { label: "Resume", run: onResume },
    { label: "New secret", run: onSecret },
    { label: "Remove", danger: true, run: onRemove },
  ];
  return (
    <span className="relative flex justify-end">
      {/* eslint-disable-next-line no-restricted-syntax -- a transparent click catcher for the dropdown beside it; it has to stay in the dropdown's layer, under the menu */}
      {open && <span className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Webhook actions"
        title="Webhook actions"
        className="ta-icon-btn h-[30px] w-[30px]"
        style={{ borderRadius: 8, color: "var(--icon-tertiary)", background: open ? "var(--fill-hover)" : undefined }}
      >
        <EllipsisVertical className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+4px)] z-50 w-[200px] p-1.5"
          style={{ borderRadius: 12, background: "var(--surface-card)", boxShadow: "var(--ta-menu-shadow)" }}
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className="ta-hoverable flex h-8 w-full items-center whitespace-nowrap px-2.5 text-left"
              style={{ border: 0, borderRadius: 8, background: "transparent", cursor: "pointer", font: "var(--type-body2)", color: it.danger ? "var(--text-error)" : "var(--text-primary)" }}
              onClick={() => {
                setOpen(false);
                it.run();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

const CONFIRM_COPY: Record<Confirm["kind"], { title: string; tone: "danger" | "warning"; confirm: string; pending: string; body: (n: string) => string }> = {
  pause: {
    title: "Pause webhook?",
    tone: "warning",
    confirm: "Pause",
    pending: "Pausing…",
    body: (n) => `"${n}" stops being told about terminations and rehires until you resume it. Nothing that happens while it is paused is sent later.`,
  },
  secret: {
    title: "Make a new secret?",
    tone: "warning",
    confirm: "Make new secret",
    pending: "Making…",
    body: (n) => `The current secret stops working right away, so "${n}" will refuse CloudTime's messages until it is given the new one.`,
  },
  remove: {
    title: "Remove webhook?",
    tone: "danger",
    confirm: "Remove",
    pending: "Removing…",
    body: (n) => `"${n}" is removed with its delivery history, and the other system stops hearing from CloudTime. This can't be undone.`,
  },
};

export function WebhooksManager({
  hooks,
  ready,
  note,
  createOpen,
  onCreateOpenChange,
}: {
  hooks: WebhookRow[];
  /** False when this server has no signing key: nothing can be made or sent. */
  ready: boolean;
  /** Where this copy of CloudTime sends, when it is not live. */
  note: string | null;
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ title: string; name: string; secret: string } | null>(null);
  const [deliveries, setDeliveries] = useState<{ hook: WebhookRow; test: boolean } | null>(null);
  const { message, flash } = useToast();
  const active = hooks.filter((h) => h.isActive).length;

  const ask = (kind: Confirm["kind"], h: WebhookRow) => {
    setConfirmError(null);
    setConfirm({ kind, id: h.id, name: h.name });
  };

  const resume = (h: WebhookRow) =>
    startTransition(async () => {
      const r = await setWebhookActive({ id: h.id, active: true });
      flash(r.success ? `"${h.name}" is active again.` : r.error);
      router.refresh();
    });

  const doConfirm = () => {
    if (!confirm) return;
    const c = confirm;
    setConfirmError(null);
    startTransition(async () => {
      if (c.kind === "pause") {
        const r = await setWebhookActive({ id: c.id, active: false });
        if (!r.success) return setConfirmError(r.error);
        flash(`"${c.name}" is paused.`);
      } else if (c.kind === "secret") {
        const r = await rotateWebhookSecret({ id: c.id });
        if (!r.success) return setConfirmError(r.error);
        setSecret({ title: "New secret", name: c.name, secret: r.data.secret });
      } else {
        const r = await removeWebhook({ id: c.id });
        if (!r.success) return setConfirmError(r.error);
        flash(`"${c.name}" removed.`);
      }
      setConfirm(null);
      router.refresh();
    });
  };

  return (
    <>
      <section style={PANEL}>
        <div className="flex flex-col gap-0.5 px-5 pb-3 pt-4">
          <span style={{ font: "var(--weight-semibold) 15px/20px var(--font-sans)", color: "var(--text-primary)" }}>Webhooks</span>
          <span className="tabular" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
            {hooks.length === 0 ? "None yet" : `${active} active of ${hooks.length}`}
            {note ? `. ${note}` : ""}
          </span>
        </div>

        {!ready && (
          <div className="px-5 pb-4">
            <Banner
              tone="warning"
              title="Webhooks aren't set up on this server"
              body="Its signing key (WEBHOOK_SIGNING_KEY) isn't set, so no webhook can be created or sent from here."
            />
          </div>
        )}

        {hooks.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 px-6 pb-14 pt-10 text-center">
            <span
              className="grid h-[52px] w-[52px] place-items-center"
              style={{ borderRadius: 16, background: "var(--ta-well)", boxShadow: "inset 0 0 0 1px var(--ta-well-ring)", color: "var(--icon-disabled)" }}
            >
              <Webhook className="h-[26px] w-[26px]" aria-hidden />
            </span>
            <span style={{ font: "var(--weight-semibold) 15px/22px var(--font-sans)", color: "var(--text-primary)" }}>No webhooks yet</span>
            <span style={{ maxWidth: 400, font: "var(--type-body1)", color: "var(--text-secondary)" }}>
              A webhook tells another system the moment someone here is terminated or rehired. Use New Webhook above.
            </span>
          </div>
        ) : (
          <div className={`ta-scroll overflow-x-auto ${styles.scroller}`}>
            <div className="min-w-[700px]">
              <div
                className={`mx-1.5 grid h-[38px] items-center gap-x-3 whitespace-nowrap px-3.5 ${styles.cols} ${styles.listHead}`}
                style={{
                  borderRadius: 12,
                  background: "var(--ta-well)",
                  font: "var(--weight-semibold) 11px/14px var(--font-sans)",
                  letterSpacing: ".07em",
                  textTransform: "uppercase",
                  color: "var(--text-tertiary)",
                }}
              >
                <span>Webhook</span>
                <span>Sends</span>
                <span>Last delivery</span>
                <span>Status</span>
                <span />
              </div>
              <div className="flex flex-col gap-0.5 px-1.5 py-1">
                {hooks.map((h) => (
                  <div key={h.id} className={`ta-row-btn grid min-h-14 items-center gap-x-3 px-3.5 py-2 ${styles.cols} ${styles.row}`} style={{ cursor: "default" }}>
                    <span className="flex min-w-0 items-center gap-3">
                      <span
                        className="grid h-[34px] w-[34px] flex-none place-items-center"
                        style={{
                          borderRadius: 10,
                          background: h.isActive ? "var(--surface-info)" : "var(--ta-well)",
                          color: h.isActive ? "var(--icon-accent)" : "var(--icon-disabled)",
                        }}
                      >
                        <Webhook className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span
                          className="min-w-0 truncate"
                          title={h.name}
                          style={{ font: "var(--weight-semibold) 14px/20px var(--font-sans)", color: h.isActive ? "var(--text-primary)" : "var(--text-tertiary)" }}
                        >
                          {h.name}
                        </span>
                        <span className={styles.url} title={h.url}>
                          {h.url}
                        </span>
                      </span>
                    </span>
                    <span className="min-w-0 truncate" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                      {eventsSummary(h.events)}
                    </span>
                    <span className="tabular min-w-0 truncate" style={{ font: "var(--type-body2)", color: h.last ? (h.last.ok ? "var(--text-secondary)" : "var(--text-error)") : "var(--text-tertiary)" }}>
                      {h.last
                        ? `${h.last.ok ? "Delivered" : h.last.statusCode ? `Failed (${h.last.statusCode})` : "Failed"}, ${when(new Date(h.last.attemptedAt))}`
                        : "Never sent"}
                    </span>
                    <span>
                      <Badge tone={h.isActive ? "success" : "neutral"} size="sm" dot>
                        {h.isActive ? "Active" : "Paused"}
                      </Badge>
                    </span>
                    <RowMenu
                      hook={h}
                      disabled={pending || !ready}
                      onTest={() => setDeliveries({ hook: h, test: true })}
                      onDeliveries={() => setDeliveries({ hook: h, test: false })}
                      onPause={() => ask("pause", h)}
                      onResume={() => resume(h)}
                      onSecret={() => ask("secret", h)}
                      onRemove={() => ask("remove", h)}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {hooks.length > 0 && (
          <div className="tabular mx-1.5 mb-1.5 flex items-center px-3.5 py-2.5" style={{ borderRadius: 12, background: "var(--ta-well)", font: "var(--type-body2)", color: "var(--text-secondary)" }}>
            {hooks.length} {hooks.length === 1 ? "webhook" : "webhooks"}
          </div>
        )}
      </section>

      {createOpen && (
        <NewWebhookWindow
          onClose={() => onCreateOpenChange(false)}
          onCreated={(name, s) => {
            onCreateOpenChange(false);
            setSecret({ title: "Webhook created", name, secret: s });
            router.refresh();
          }}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={CONFIRM_COPY[confirm.kind].title}
          tone={CONFIRM_COPY[confirm.kind].tone}
          confirmLabel={CONFIRM_COPY[confirm.kind].confirm}
          pendingLabel={CONFIRM_COPY[confirm.kind].pending}
          pending={pending}
          error={confirmError}
          onConfirm={doConfirm}
          onCancel={() => setConfirm(null)}
        >
          {CONFIRM_COPY[confirm.kind].body(confirm.name)}
        </ConfirmDialog>
      )}

      {secret && <SecretWindow title={secret.title} name={secret.name} secret={secret.secret} onClose={() => setSecret(null)} />}
      {deliveries && <DeliveriesWindow hook={deliveries.hook} testFirst={deliveries.test} onClose={() => setDeliveries(null)} />}

      <Toast message={message} />
    </>
  );
}
