"use client";

import { useEffect, useRef, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { useRouter } from "@/components/layout/navigation-progress";
import { Banner, Button, Checkbox, Input, Switch } from "@/components/ui";
import { SetupShell } from "./setup-shell";
import { NotCalculated } from "./setup-ui";

/**
 * The frame every Rules Setup editor page shares: the rule set, the shift,
 * the holiday rule and the leave policy.
 *
 * <p>One page per record, in the SetupShell. Every section sits on the page
 * at once, down a rail that says which are switched on and follows the
 * scroll. Save is pinned in the header and only lights up once something has
 * changed, judged by comparing what the form would send with what it sent
 * when it opened. Leaving with changes not saved asks first, from any link
 * on the page or from closing the tab.
 */

const caption = { font: "var(--type-caption1)", color: "var(--text-tertiary)", textWrap: "pretty" } as const;
export const words = { font: "var(--type-body1)", color: "var(--text-secondary)" } as const;

/* ── Sections and rows ────────────────────────────────────────────────── */

/** A section of an editor: one panel with a heading, one quiet line, and rows. */
export function Section({
  id,
  title,
  hint,
  on,
  onToggle,
  offText,
  unused,
  children,
}: {
  id: string;
  title: string;
  hint: string;
  /** Sections that can be switched off carry the switch in their header. */
  on?: boolean;
  onToggle?: (on: boolean) => void;
  offText?: string;
  unused?: boolean;
  children: ReactNode;
}) {
  const off = onToggle && !on;
  return (
    <section
      id={`sec-${id}`}
      data-editor-section={id}
      aria-label={title}
      className="ta-card flex flex-col"
      style={{ borderRadius: "var(--radius-l)", scrollMarginTop: "var(--shell-top)" }}
    >
      <header className="flex items-start gap-3 px-5 pb-3.5 pt-4">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <h2 style={{ margin: 0, font: "var(--type-h3)", color: "var(--text-primary)" }}>{title}</h2>
            {unused && <NotCalculated />}
          </span>
          <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-secondary)", textWrap: "pretty" }}>{hint}</p>
        </span>
        {onToggle && (
          <span className="flex flex-none items-center pt-0.5">
            <Switch checked={!!on} onChange={onToggle} label={on ? "On" : "Off"} />
          </span>
        )}
      </header>
      {off && offText && (
        <p className="px-5 pb-4" style={{ margin: 0, ...caption }}>
          {offText}
        </p>
      )}
      {/* Kept mounted while off: the form reads every field on save. */}
      <div hidden={off} className="flex flex-col">
        {children}
      </div>
    </section>
  );
}

/** One setting: its name and a quiet line on the left, the control on the right. */
export function Row({ label, hint, unused, children }: { label: string; hint?: string; unused?: boolean; children: ReactNode }) {
  return (
    <div
      className="grid gap-x-6 gap-y-2 px-5 py-3.5 md:[grid-template-columns:240px_minmax(0,1fr)]"
      style={{ borderTop: "1px solid var(--stroke-divider)" }}
    >
      <span className="flex min-w-0 flex-col gap-0.5 pt-1.5">
        <span className="flex flex-wrap items-center gap-2">
          <span style={{ font: "var(--type-body1)", fontWeight: "var(--weight-medium)", color: "var(--text-primary)" }}>
            {label}
          </span>
          {unused && <NotCalculated />}
        </span>
        {hint && <span style={caption}>{hint}</span>}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2">{children}</span>
    </div>
  );
}

/** A number box with its unit after it. Named, it submits itself. */
export function Num({
  unit,
  width = 88,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & { unit?: string; width?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span style={{ width }}>
        <Input type="number" className="tabular" style={{ width }} {...rest} />
      </span>
      {unit && <span style={words}>{unit}</span>}
    </span>
  );
}

/** A checkbox whose value the form reads from a hidden input beside it. */
export function Tick({
  name,
  checked,
  onChange,
  label,
}: {
  name?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
}) {
  return (
    <>
      <Checkbox checked={checked} onChange={onChange} label={label} />
      {name && <input type="hidden" name={name} value={checked ? "true" : "false"} />}
    </>
  );
}

/** Scroll a section to the top, moving only the page's own scroller. */
export function jumpToSection(id: string) {
  // scrollIntoView also nudges every scrollable parent, the app frame
  // included, and slid the top bar away.
  const el = document.getElementById(`sec-${id}`);
  if (!el) return;
  let scroller: HTMLElement | null = el.parentElement;
  while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
  const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  if (!scroller) return window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - margin, behavior: "smooth" });
  const y = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - margin;
  scroller.scrollTo({ top: y, behavior: "smooth" });
}

/* ── Leaving with unsaved changes ─────────────────────────────────────── */

function useLeaveGuard(dirty: boolean, noun: string) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    // Any link on the page, the sidebar included, asks first.
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.origin !== window.location.origin) return;
      e.preventDefault();
      e.stopPropagation();
      setPending(a.pathname + a.search);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("click", onClick, true);
    };
  }, []);

  return pending ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(3, 7, 18, 0.5)" }}
      onClick={(e) => e.target === e.currentTarget && setPending(null)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="editor-leave-title"
        className="ta-modal flex w-full max-w-[420px] flex-col gap-2 p-5"
        style={{ borderRadius: "var(--radius-l)" }}
      >
        <h2 id="editor-leave-title" style={{ margin: 0, font: "var(--type-h3)", color: "var(--text-primary)" }}>
          Discard unsaved changes?
        </h2>
        <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-secondary)" }}>
          The changes on this {noun} have not been saved. Leaving now loses them.
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <Button hierarchy="secondary" onClick={() => setPending(null)}>
            Keep editing
          </Button>
          <Button
            tone="error"
            onClick={() => {
              const to = pending;
              dirtyRef.current = false;
              setPending(null);
              router.push(to);
            }}
          >
            Discard changes
          </Button>
        </div>
      </div>
    </div>
  ) : null;
}

/* ── The page ─────────────────────────────────────────────────────────── */

export interface EditorGroup {
  title: string;
  areas: { id: string; label: string; count?: string }[];
}

export function EditorPage({
  noun,
  title,
  subtitle,
  back,
  groups,
  isNew,
  submitLabel,
  pending,
  error,
  savedCount,
  onSubmit,
  children,
}: {
  /** "rule set", "shift": what the leave warning calls it. */
  noun: string;
  title: ReactNode;
  subtitle: ReactNode;
  back: { href: string; label: string };
  groups: EditorGroup[];
  isNew: boolean;
  submitLabel: string;
  pending: boolean;
  error: string | null;
  /** Goes up by one after each successful save, which makes the page clean again. */
  savedCount: number;
  onSubmit: (form: HTMLFormElement) => void;
  children: ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  // The baseline is what the form sent when it opened, or when it was last
  // saved. Switches and checkboxes change hidden inputs, which fire no
  // event, so the comparison also runs just after every render. A timer
  // rather than a frame callback: a browser pauses those in a hidden tab,
  // and the check then lagged one change behind.
  const baseline = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const snapshot = () => (formRef.current ? JSON.stringify([...new FormData(formRef.current).entries()]) : "");
  const check = () => {
    if (baseline.current === null) baseline.current = snapshot();
    else setDirty(snapshot() !== baseline.current);
  };
  useEffect(() => {
    const t = setTimeout(check, 0);
    return () => clearTimeout(t);
  });
  // A save makes what is on screen the new starting point.
  const seen = useRef(savedCount);
  useEffect(() => {
    if (seen.current === savedCount) return;
    seen.current = savedCount;
    const t = setTimeout(() => {
      baseline.current = snapshot();
      setDirty(false);
    }, 0);
    return () => clearTimeout(t);
  }, [savedCount]);
  const leaveDialog = useLeaveGuard(dirty, noun);

  /* The rail follows the scroll. */
  const first = groups[0]?.areas[0]?.id ?? "";
  const [active, setActive] = useState(first);
  const jumping = useRef(0);
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      if (Date.now() < jumping.current) return;
      const top = parseFloat(getComputedStyle(formRef.current ?? document.body).getPropertyValue("--shell-top")) || 96;
      const els = [...document.querySelectorAll<HTMLElement>("[data-editor-section]")];
      let current = els[0]?.dataset.editorSection;
      for (const el of els) if (el.getBoundingClientRect().top - top <= 48) current = el.dataset.editorSection;
      const last = els[els.length - 1];
      if (last && last.getBoundingClientRect().bottom <= window.innerHeight - 8) current = last.dataset.editorSection;
      if (current) setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  function jump(id: string) {
    setActive(id);
    jumping.current = Date.now() + 700;
    jumpToSection(id);
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    if (form.querySelector('[aria-invalid="true"]')) {
      const section = (form.querySelector('[aria-invalid="true"]')?.closest("[data-editor-section]") as HTMLElement | null)?.dataset
        .editorSection;
      if (section) jump(section);
      return setLocalError("One of the times cannot be read. Use a time like 8:30.");
    }
    setLocalError(null);
    onSubmit(form);
  }

  const shown = localError ?? error;
  const status = pending ? null : dirty ? "Unsaved changes" : savedCount > 0 ? "Saved" : null;
  const formId = "editor-form";

  return (
    <SetupShell
      title={title}
      subtitle={subtitle}
      back={back}
      actions={
        <>
          {status && (
            <span
              className="whitespace-nowrap"
              style={{ font: "var(--type-body2)", color: dirty ? "var(--text-warning)" : "var(--text-tertiary)" }}
              aria-live="polite"
            >
              {status}
            </span>
          )}
          <Button type="submit" form={formId} disabled={pending || (!isNew && !dirty)}>
            {pending ? "Saving…" : submitLabel}
          </Button>
        </>
      }
      railLabel={`${noun.charAt(0).toUpperCase()}${noun.slice(1)} sections`}
      groups={groups}
      active={active}
      onPick={jump}
    >
      <form
        id={formId}
        ref={formRef}
        onSubmit={submit}
        onInput={check}
        onChange={check}
        noValidate
        className="flex flex-col gap-4 pb-[40vh]"
      >
        {shown && <Banner tone="error" title="Not saved" body={shown} />}
        {children}
      </form>
      {leaveDialog}
    </SetupShell>
  );
}

/** The last section of an editor: delete, or why it cannot be. */
export function DeleteSection({ title, reason, children }: { title: string; reason: string; children?: ReactNode }) {
  return (
    <section
      id="sec-delete"
      data-editor-section="delete"
      aria-label={title}
      className="ta-card flex flex-wrap items-center gap-3 px-5 py-4"
      style={{ borderRadius: "var(--radius-l)", scrollMarginTop: "var(--shell-top)" }}
    >
      <span className="flex min-w-[240px] flex-1 flex-col gap-0.5">
        <h2 style={{ margin: 0, font: "var(--type-h3)", color: "var(--text-primary)" }}>{title}</h2>
        <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-secondary)" }}>{reason}</p>
      </span>
      {children}
    </section>
  );
}
