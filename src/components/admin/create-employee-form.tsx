"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode, type SelectHTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { createEmployee, getSupervisorOptions } from "@/actions/admin.actions";
import type { CopyFromEmployee } from "@/lib/employee-copy";
import { asksForClientBadge, isClientBadge } from "@/lib/utils/client-badge";
import { LANGUAGES } from "@/lib/languages";
import type { Site, Department, RuleSet } from "@prisma/client";
import { Banner, Button, Input, SegmentedControl, Select } from "@/components/ui";
import { Overlay } from "@/components/ui/overlay";
import { Check, CircleCheck, Plus, UserPlus, X } from "lucide-react";
import styles from "./new-employee-window.module.css";

/**
 * "Add Employee" — the design's primary action on the employee list.
 *
 * <p>The design opens the empty doc screen for this; here it stays a modal,
 * because the record cannot exist until it has a site, a department and a rule
 * set, and a half-filled employee page with no id to save against would need a
 * draft state the server has no concept of.
 *
 * <p>The window follows the Export window on Live Attendance: a grey frame and
 * one white card. Three steps in order; Continue checks the step's required
 * fields before moving on, so a required field is never left behind on a step
 * nobody opened. The header turns into the person once a name is typed.
 *
 * <p>The steps are visual only — every field stays mounted, so one submit sends
 * the whole record. Hiding a step must not drop the fields on it; a new hire
 * created without a pay category is a timecard that will not export.
 */

type EmployeeOption = { id: string; user: { name: string | null } };

const BUILTIN_ROLES = [
  { value: "EMPLOYEE",      label: "Employee" },
  { value: "SUPERVISOR",    label: "Supervisor" },
  { value: "PAYROLL_ADMIN", label: "Payroll Admin" },
  { value: "HR_ADMIN",      label: "HR Admin" },
  { value: "SYSTEM_ADMIN",  label: "System Admin" },
] as const;

type BuiltinRole = (typeof BUILTIN_ROLES)[number]["value"];

type Step = "job" | "pay" | "personal";

const STEPS: { value: Step; title: string; optional?: boolean }[] = [
  { value: "job", title: "Job and badge" },
  { value: "pay", title: "Pay and schedule" },
  { value: "personal", title: "Personal details", optional: true },
];

/** The fields the server refuses to save without, and the step each sits on. */
type Snapshot = {
  name: string;
  hireDate: string;
  wmsId: string;
  workEmail: string;
  email: string;
  departmentId: string;
  ruleSetId: string;
  shiftId: string;
  payCategoryId: string;
  holidayRuleId: string;
  agencyId: string;
  /** The role chosen makes a login with no timecard (sign-in-only.ts). */
  signIn: boolean;
  /** ...and one that views a team: an agency viewer, who needs its agency. */
  needsAgency: boolean;
  /** The role chosen is a visitor's: a badge for the security gate and nothing else. */
  visitor: boolean;
  siteId: string;
};

/** A client badge (client-badge.ts) works no shift and keeps no timecard. */
const forClient = (s: Snapshot) => asksForClientBadge(s.wmsId) || isClientBadge(s.wmsId);
/** Needed of anyone with a timecard: not a sign in only account or a visitor. */
const timecard = (s: Snapshot) => !s.signIn && !s.visitor;

const NEEDED: { step: Step; label: string; missing: (s: Snapshot) => boolean }[] = [
  { step: "job", label: "full name", missing: (s) => !s.name.trim() },
  { step: "job", label: "hire date", missing: (s) => !s.hireDate && timecard(s) },
  { step: "job", label: "badge ID", missing: (s) => !s.wmsId.trim() && timecard(s) },
  { step: "job", label: "site", missing: (s) => !s.siteId },
  // A client badge and a visitor sign nobody in (client-badge.ts).
  { step: "job", label: "a work or personal email", missing: (s) => !s.workEmail.trim() && !s.email.trim() && !forClient(s) && !s.visitor },
  { step: "job", label: "department", missing: (s) => !s.departmentId },
  { step: "job", label: "agency", missing: (s) => !s.agencyId && s.needsAgency },
  { step: "pay", label: "rule set", missing: (s) => !s.ruleSetId && timecard(s) },
  { step: "pay", label: "holiday rule", missing: (s) => !s.holidayRuleId && !forClient(s) && timecard(s) },
  { step: "pay", label: "shift", missing: (s) => !s.shiftId && !forClient(s) && timecard(s) },
  { step: "pay", label: "pay category", missing: (s) => !s.payCategoryId && !forClient(s) && timecard(s) },
];

interface Props {
  sites: Site[];
  departments: (Department & { sites: { site: Pick<Site, "id" | "name"> }[] })[];
  ruleSets: RuleSet[];
  /**
   * Who can be picked as supervisor. Left out, the window asks for the list
   * when it opens, so the page does not carry every name in the company.
   */
  employees?: EmployeeOption[];
  /** signInOnly, seesTeam and visitor: see sign-in-only.ts. */
  customRoles: { id: string; name: string; signInOnly?: boolean; seesTeam?: boolean; visitor?: boolean }[];
  /** The badge the next visitor gets (a preview: it is taken at the save). */
  nextVisitorBadge?: string | null;
  /** The department every visitor is filed in. */
  visitorDepartment?: { id: string; name: string } | null;
  shifts: { id: string; name: string; startTime: string; endTime: string }[];
  holidayRules: { id: string; name: string }[];
  payCategories: { id: string; number: number; description: string | null }[];
  payTypes: { id: string; number: number; description: string | null }[];
  jobTitles: { id: string; name: string; externalId: string | null }[];
  agencies: { id: string; code: number; description: string; inactiveOn: Date | string | null }[];
  copyFrom?: CopyFromEmployee | null;
}

function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

/** Today as the date field shows it (yyyy-MM-dd), on this computer's clock. */
function todayIso(): string {
  return format(new Date(), "yyyy-MM-dd");
}

/** "a", "a and b", "a, b and c". */
function listOf(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** A labelled select, laid out like the kit's `Input` stack. */
function SelectField({
  label,
  required,
  children,
  id,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  const fieldId = id ?? `c-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className={styles.field}>
      <label htmlFor={fieldId} className={styles.fieldLabel}>
        {label}
        {required && (
          <span aria-hidden="true" className={styles.required}>
            *
          </span>
        )}
      </label>
      <Select id={fieldId} required={required} {...rest} style={{ width: "100%" }}>
        {children}
      </Select>
    </div>
  );
}

/** A group of fields in the card: a name, an optional line, then its rows. */
function Block({ label, note, noteTone, children }: { label: string; note?: string; noteTone?: "error"; children: ReactNode }) {
  return (
    <section className={styles.block}>
      <div className={styles.blockHead}>
        <h3 className={styles.blockLabel}>{label}</h3>
        {note && (
          <p className={styles.blockNote} data-tone={noteTone} role={noteTone ? "alert" : undefined}>
            {note}
          </p>
        )}
      </div>
      <div className={styles.rows}>{children}</div>
    </section>
  );
}

function Row({ cols = 2, children }: { cols?: 1 | 2 | 3 | 4; children: ReactNode }) {
  return (
    <div className={styles.row} data-cols={cols}>
      {children}
    </div>
  );
}

export function CreateEmployeeForm({ sites, departments, ruleSets, employees, customRoles, shifts, holidayRules, payCategories, payTypes, jobTitles, agencies, nextVisitorBadge, visitorDepartment, copyFrom }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copy, setCopy] = useState<CopyFromEmployee | null>(copyFrom ?? null);
  const [open, setOpen] = useState(!!copyFrom);
  const [step, setStep] = useState<Step>("job");
  // Steps the person has moved past; only those can show as done.
  const [visited, setVisited] = useState<Set<Step>>(() => new Set());
  const [emailError, setEmailError] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);

  // The supervisor list, asked for the first time the window opens when the
  // page did not hand one over. A failed ask is tried again on the next open.
  const [loadedSupervisors, setLoadedSupervisors] = useState<EmployeeOption[] | null>(null);
  const [supervisorsFailed, setSupervisorsFailed] = useState(false);
  const supervisors = employees ?? loadedSupervisors;
  useEffect(() => {
    if (!open || employees || loadedSupervisors) return;
    let dead = false;
    getSupervisorOptions()
      .then((r) => {
        if (dead) return;
        if (r.success) setLoadedSupervisors(r.data);
        else setSupervisorsFailed(true);
      })
      .catch(() => {
        if (!dead) setSupervisorsFailed(true);
      });
    return () => {
      dead = true;
    };
  }, [open, employees, loadedSupervisors]);

  const [payType, setPayType] = useState<string>(copyFrom ? (copyFrom.payType ?? "") : "HOURLY");
  // Blank unless copying, as the department and rule set: the building is chosen.
  const [selectedSiteId, setSelectedSiteId] = useState(copyFrom?.siteId ?? "");
  const filteredDepts = departments.filter((d) => d.sites.some((ds) => ds.site.id === selectedSiteId));
  const activeAgencies = agencies.filter((a) => !a.inactiveOn || new Date(a.inactiveOn) > new Date());

  // What the header, the steps and the footer read. The fields stay
  // uncontrolled; this is read back from the form whenever one changes.
  /** What the role picked (its select value) makes of the account. */
  const roleKind = (value: string | null | undefined) => {
    const role = value?.startsWith("custom:") ? customRoles.find((r) => r.id === value.slice(7)) : undefined;
    return { signIn: !!role?.signInOnly, needsAgency: !!role?.signInOnly && !!role?.seesTeam, visitor: !!role?.visitor };
  };
  const blankSnapshot = (c: CopyFromEmployee | null): Snapshot => ({
    ...roleKind(c?.role),
    agencyId: c?.agencyId ?? "",
    siteId: c?.siteId ?? "",
    name: "",
    hireDate: "",
    wmsId: "",
    workEmail: "",
    email: "",
    // Blank unless copying: each is chosen, never the first in its list. The
    // Rule Set used to start on the first by name, "Ca Exempt - Punch", and a
    // Georgia and a Rutherford hire were saved on it unseen (no overtime).
    departmentId: c?.departmentId ?? "",
    ruleSetId: c?.ruleSetId ?? "",
    shiftId: c?.shiftId ?? "",
    payCategoryId: c?.payCategoryId ?? "",
    holidayRuleId: c?.holidayRuleId ?? "",
  });
  const [snap, setSnap] = useState<Snapshot>(() => blankSnapshot(copyFrom ?? null));

  function readForm() {
    const f = formRef.current;
    if (!f) return;
    const fd = new FormData(f);
    const v = (k: string) => (fd.get(k) as string | null) ?? "";
    const next = {
      name: v("name"),
      hireDate: v("hireDate"),
      wmsId: v("wmsId"),
      workEmail: v("workEmail"),
      email: v("email"),
      departmentId: v("departmentId"),
      ruleSetId: v("ruleSetId"),
      shiftId: v("shiftId"),
      payCategoryId: v("payCategoryId"),
      holidayRuleId: v("holidayRuleId"),
      agencyId: v("agencyId"),
      siteId: v("siteId"),
      ...roleKind(v("role")),
    };
    setSnap(next);
    if (next.workEmail.trim() || next.email.trim()) setEmailError(false);
  }

  function handleClose() {
    setOpen(false);
    // A list that failed to load is asked for again on the next open.
    setSupervisorsFailed(false);
    setStep("job");
    setVisited(new Set());
    setEmailError(false);
    setError(null);
    if (copy) {
      // The next Add Employee starts blank, and a refresh does not reopen the copy.
      setCopy(null);
      setSelectedSiteId("");
      setPayType("HOURLY");
      setSnap(blankSnapshot(null));
      const url = new URL(window.location.href);
      url.searchParams.delete("copyFrom");
      router.replace(url.pathname + url.search);
    } else {
      setSelectedSiteId("");
      setSnap(blankSnapshot(null));
    }
  }

  // Escape closes, focus starts on the name and goes back to the opener.
  const closeRef = useRef(handleClose);
  useEffect(() => {
    closeRef.current = handleClose;
  });
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const first = windowRef.current?.querySelector<HTMLInputElement>('input[name="name"]');
    (first ?? windowRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, [open]);

  // A sign in only account has no pay and schedule step: it keeps no timecard.
  const steps = snap.signIn ? STEPS.filter((s) => s.value !== "pay") : STEPS;
  const stepIndex = steps.findIndex((s) => s.value === step);
  const nextStep = steps[stepIndex + 1];
  const prevStep = steps[stepIndex - 1];
  const onLast = !nextStep;

  function goTo(target: Step) {
    setVisited((v) => new Set(v).add(step));
    setStep(target);
    requestAnimationFrame(() => {
      windowRef.current?.querySelector(`.${styles.card}`)?.scrollTo({ top: 0 });
    });
  }

  /** The step's own required fields, checked where the person can see them. */
  function stepIsReady(s: Step): boolean {
    const panel = formRef.current?.querySelector<HTMLElement>(`[data-step="${s}"]`);
    const fields = panel ? Array.from(panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")) : [];
    const bad = fields.find((f) => !f.checkValidity());
    if (bad) {
      bad.reportValidity();
      return false;
    }
    if (s === "job" && !snap.workEmail.trim() && !snap.email.trim() && !forClient(snap) && !snap.visitor) {
      setEmailError(true);
      formRef.current?.querySelector<HTMLInputElement>('input[name="workEmail"]')?.focus();
      return false;
    }
    return true;
  }

  function handleContinue() {
    if (nextStep && stepIsReady(step)) goTo(nextStep.value);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Enter in a field on an early step moves on rather than creating.
    if (!onLast) {
      handleContinue();
      return;
    }
    // Saved from the last step with an earlier step incomplete (reached by
    // clicking ahead): go back to it and say what is missing there.
    const firstGap = NEEDED.find((n) => n.missing(snap));
    if (firstGap && firstGap.step !== step) {
      setStep(firstGap.step);
      requestAnimationFrame(() => stepIsReady(firstGap.step));
      return;
    }
    setError(null);
    const fd = new FormData(e.currentTarget);

    startTransition(async () => {
      const rawRole = (fd.get("role") as string) || "EMPLOYEE";
      const isCustom = rawRole.startsWith("custom:");
      const role: BuiltinRole = isCustom ? "EMPLOYEE" : (rawRole as BuiltinRole);
      const customRoleId = isCustom ? rawRole.slice(7) : undefined;

      const payRateRaw = fd.get("payRate") as string;

      const result = await createEmployee({
        name: fd.get("name") as string,
        // Switched off for a visitor, who never signs in: not sent.
        email: (fd.get("email") as string | null) ?? "",
        workEmail: (fd.get("workEmail") as string | null) ?? "",
        employeeCode: (fd.get("employeeCode") as string) || "",
        role,
        customRoleId,
        siteId: fd.get("siteId") as string,
        departmentId: fd.get("departmentId") as string,
        // A sign in only account's pay and schedule fields are switched off,
        // so not sent: the server puts it on UNASSIGNED.
        ruleSetId: (fd.get("ruleSetId") as string | null) || undefined,
        hireDate: (fd.get("hireDate") as string | null) || undefined,
        supervisorId: fd.get("supervisorId") as string,
        wmsId: (fd.get("wmsId") as string | null) || undefined,
        signInOnly: snap.signIn,
        visitor: snap.visitor,
        payType: (fd.get("payType") as "HOURLY" | "SALARY" | null) || null,
        payTypeId: (fd.get("payTypeId") as string) || null,
        payRate: payRateRaw ? Number(payRateRaw) : null,
        jobTitle: null, // legacy free-text title; the form now picks a job title by id
        jobTitleId: (fd.get("jobTitleId") as string) || null,
        agencyId: (fd.get("agencyId") as string) || null,
        adpWorkerId: fd.get("adpWorkerId") as string,
        shiftId: fd.get("shiftId") as string,
        holidayRuleId: fd.get("holidayRuleId") as string,
        payCategoryId: fd.get("payCategoryId") as string,
        gender: fd.get("gender") as string,
        maritalStatus: fd.get("maritalStatus") as string,
        phone: fd.get("phone") as string,
        phone2: fd.get("phone2") as string,
        emergencyContact: fd.get("emergencyContact") as string,
        emergencyPhone: fd.get("emergencyPhone") as string,
        emergencyRelationship: fd.get("emergencyRelationship") as string,
        address1: fd.get("address1") as string,
        address2: fd.get("address2") as string,
        city: fd.get("city") as string,
        state: fd.get("state") as string,
        country: fd.get("country") as string,
        zipCode: fd.get("zipCode") as string,
        preferredLanguage: (fd.get("preferredLanguage") as string | null) || null,
      });

      if (!result.success) {
        setError(result.error);
        return;
      }

      handleClose();
      router.refresh();
    });
  }

  /**
   * A step's panel.
   *
   * <p>The inactive steps are switched off in an inline style, not with a
   * `hidden` class. They stay in the DOM either way: `display: none` fields
   * are still submitted, and dropping them would create employees with no pay
   * category.
   */
  const invalidShown = useRef(false);
  const panelStyle = (s: Step): React.CSSProperties => ({ display: step === s ? "block" : "none" });

  const missing = NEEDED.filter((n) => n.missing(snap));
  const client = forClient(snap);
  const stepDone = (s: Step) =>
    !steps.find((x) => x.value === s)?.optional && visited.has(s) && !missing.some((n) => n.step === s);

  const name = snap.name.trim();
  const initials = initialsOf(name);
  const facts = [
    snap.wmsId.trim() && `Badge ${snap.wmsId.trim()}`,
    snap.hireDate && `Starts ${format(parseISO(snap.hireDate), "MMM d, yyyy")}`,
  ].filter(Boolean) as string[];
  const subtitle = copy
    ? `Setup copied from ${copy.sourceName}. Name, emails, badge, hire date, personal details and pay rate start blank.`
    : facts.length
      ? `${facts.join(". ")}.`
      : "Three short steps. Personal details are optional.";

  return (
    <>
      <Button
        className="ta-header-primary"
        onClick={() => setOpen(true)}
        leadingIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
      >
        Add Employee
      </Button>

      {open && (
        <Overlay
          className={`${styles.scrim} ta-sheet-scrim`}
          onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
        >
          <div
            ref={windowRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-employee-title"
            className={`${styles.window} ta-sheet`}
          >
            <header className={styles.head}>
              <span className={styles.glyph} data-person={!!initials} aria-hidden="true">
                {initials || <UserPlus />}
              </span>
              <span className={styles.titles}>
                <h2 id="new-employee-title" className={styles.title}>
                  {name || "New employee"}
                </h2>
                <span className={styles.subtitle} title={subtitle}>{subtitle}</span>
              </span>
              <Button hierarchy="tertiary" size="sm" iconOnly onClick={handleClose} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </header>

            <ol className={styles.steps} aria-label="Steps">
              {steps.map((s, i) => (
                <li key={s.value}>
                  <button
                    type="button"
                    className={styles.step}
                    aria-current={step === s.value ? "step" : undefined}
                    data-done={stepDone(s.value)}
                    onClick={() => goTo(s.value)}
                  >
                    <span className={styles.stepBar} aria-hidden="true" />
                    <span className={styles.stepText}>
                      <span className={styles.stepNum}>{i + 1}</span>
                      <Check className={styles.stepDone} strokeWidth={3} aria-label="Done" />
                      <span className={styles.stepTitle}>{s.title}</span>
                      {s.optional && <span className={styles.stepOptional}>Optional</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ol>

            {/* One form: the steps only hide fields, they never unmount them. */}
            <form
              ref={formRef}
              className={styles.form}
              onSubmit={handleSubmit}
              onChange={readForm}
              // A required field the browser refuses on a step that is not
              // open: open that step, then let the browser point at it.
              onInvalidCapture={(e) => {
                const field = e.target as HTMLInputElement;
                if (invalidShown.current) return;
                invalidShown.current = true;
                const s = field.closest<HTMLElement>("[data-step]")?.dataset.step as Step | undefined;
                if (s) setStep(s);
                requestAnimationFrame(() => {
                  invalidShown.current = false;
                  field.reportValidity();
                });
              }}
            >
              <div className={styles.body}>
                <div className={`ta-scroll ${styles.card}`}>
                  {error && (
                    <div className={styles.banner}>
                      <Banner tone="error" body={error} />
                    </div>
                  )}

                  {/* ── 1. Job and badge ── */}
                  <div data-step="job" style={panelStyle("job")}>
                    <Block label="Person">
                      <Row cols={1}>
                        <Input label="Full Name" name="name" required autoComplete="off" />
                      </Row>
                      <Row>
                        {snap.visitor ? (
                          // A visitor: today, and the next visitor badge, filled in
                          // and not editable. "CL" asks the save for that badge
                          // (client-badge.ts); the number shown is its preview.
                          <>
                            <Input label="Hire Date" type="date" value={todayIso()} disabled readOnly />
                            <input type="hidden" name="wmsId" value="CL" />
                            <Input label="Badge ID (WMS)" value={nextVisitorBadge ?? "CL"} disabled readOnly />
                          </>
                        ) : (
                          <>
                            <Input label="Hire Date" name="hireDate" type="date" required={!snap.signIn} />
                            <Input
                              label="Badge ID (WMS)"
                              name="wmsId"
                              placeholder={snap.signIn ? "Not needed for a sign-in only account" : "The number on their QR badge"}
                              required={!snap.signIn}
                              autoComplete="off"
                            />
                          </>
                        )}
                      </Row>
                    </Block>

                    {/* Either email signs the person in (password or Google); at
                        least one is needed, which Continue and the save both say. */}
                    <Block
                      label="Sign in"
                      note={
                        snap.visitor
                          ? "Visitors never sign in, so no email."
                          : emailError
                            ? "Add a work or personal email so they can sign in."
                            : "At least one email is needed. Invites go to the work email first."
                      }
                      noteTone={emailError && !snap.visitor ? "error" : undefined}
                    >
                      <Row>
                        <Input label="Work Email" name="workEmail" type="email" autoComplete="off" disabled={snap.visitor} />
                        <Input label="Personal Email" name="email" type="email" autoComplete="off" disabled={snap.visitor} />
                      </Row>
                    </Block>

                    <Block
                      label="Placement"
                      note={
                        snap.visitor
                          ? visitorDepartment
                            ? "A visitor: a badge for the security gate, and nothing else. No sign in, time clock, timecard or pay. Choose the site they are visiting."
                            : "Visitors are filed in a department named Visitors, and there is none. Add it before adding a visitor."
                          : snap.needsAgency
                            ? "A sign-in only login: no badge, timecard or pay. They see everyone in the agency chosen below."
                            : snap.signIn
                              ? "A sign-in only login: no badge, timecard or pay, so there is no pay and schedule step."
                              : undefined
                      }
                      noteTone={snap.visitor && !visitorDepartment ? "error" : undefined}
                    >
                      <Row>
                        <SelectField
                          label="Site"
                          name="siteId"
                          value={selectedSiteId}
                          required
                          onChange={(e) => {
                            setSelectedSiteId(e.target.value);
                            // The department list changes with the site; read it
                            // back once the new options are in.
                            requestAnimationFrame(readForm);
                          }}
                        >
                          <option value="">Choose a site</option>
                          {sites.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </SelectField>
                        {snap.visitor ? (
                          // Every visitor is filed in Visitors, filled in and not editable.
                          <>
                            <input type="hidden" name="departmentId" value={visitorDepartment?.id ?? ""} />
                            <SelectField label="Department" disabled value={visitorDepartment?.id ?? ""}>
                              <option value={visitorDepartment?.id ?? ""}>{visitorDepartment?.name ?? "No Visitors department"}</option>
                            </SelectField>
                          </>
                        ) : (
                          <SelectField label="Department" name="departmentId" required defaultValue={copy?.departmentId ?? ""}>
                            <option value="">{selectedSiteId ? "Choose a department" : "Choose a site first"}</option>
                            {filteredDepts.map((d) => (
                              <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                          </SelectField>
                        )}
                      </Row>
                      <Row>
                        <SelectField label="Job Title" name="jobTitleId" disabled={snap.visitor} defaultValue={copy?.jobTitleId ?? ""}>
                          <option value="">None</option>
                          {jobTitles.map((jt) => (
                            <option key={jt.id} value={jt.id}>
                              {jt.name}{jt.externalId ? ` (${jt.externalId})` : ""}
                            </option>
                          ))}
                        </SelectField>
                        {supervisors ? (
                          <SelectField label="Supervisor" name="supervisorId" disabled={snap.visitor} defaultValue={copy?.supervisorId ?? ""}>
                            <option value="">None</option>
                            {supervisors.map((emp) => (
                              <option key={emp.id} value={emp.id}>{emp.user.name}</option>
                            ))}
                          </SelectField>
                        ) : (
                          // Until the list arrives: the field holds its place, and
                          // the copied supervisor (or None) is what a save sends, so
                          // an early save never drops it. The real list mounts with
                          // the same default once it lands.
                          <>
                            <input type="hidden" name="supervisorId" value={copy?.supervisorId ?? ""} />
                            <SelectField label="Supervisor" disabled value="">
                              <option value="">{supervisorsFailed ? "The list did not load. Close and open again." : "Loading supervisors…"}</option>
                            </SelectField>
                          </>
                        )}
                      </Row>
                      <Row>
                        <SelectField label="Role" name="role" defaultValue={copy?.role}>
                          {BUILTIN_ROLES.map((r) => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                          {customRoles.map((r) => (
                            <option key={r.id} value={`custom:${r.id}`}>{r.name}</option>
                          ))}
                        </SelectField>
                        {/* Agencies past their inactive date stay on file for the
                            people already in them, but are not offered for new hires. */}
                        <SelectField label="Agency" name="agencyId" required={snap.needsAgency} disabled={snap.visitor} defaultValue={copy?.agencyId ?? ""}>
                          <option value="">{snap.needsAgency ? "Choose the agency they view" : "None"}</option>
                          {activeAgencies.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.code} ({a.description})
                            </option>
                          ))}
                        </SelectField>
                      </Row>
                    </Block>
                  </div>

                  {/* ── 2. Pay and schedule ── */}
                  <div data-step="pay" style={panelStyle("pay")}>
                    {/* Switched off for a sign in only account and a visitor: a
                        disabled field is neither checked nor sent. */}
                    {snap.visitor && (
                      <div className={styles.banner}>
                        <Banner tone="info" body="Visitors keep no timecard, so nothing here applies to them." />
                      </div>
                    )}
                    <fieldset disabled={snap.signIn || snap.visitor} className={styles.plainFieldset}>
                    <Block label="Time rules" note="How their hours are counted.">
                      <Row>
                        <SelectField label="Rule Set" name="ruleSetId" required defaultValue={copy?.ruleSetId ?? ""}>
                          <option value="">Choose a rule set</option>
                          {ruleSets.map((rs) => (
                            <option key={rs.id} value={rs.id}>{rs.name}</option>
                          ))}
                        </SelectField>
                        {/* Required for a new hire (temps take "No Holiday"); not
                            for a client badge, which keeps no timecard. */}
                        <SelectField label="Holiday Rule" name="holidayRuleId" required={!client} defaultValue={copy?.holidayRuleId ?? ""}>
                          <option value="">Choose a holiday rule</option>
                          {holidayRules.map((r) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </SelectField>
                      </Row>
                      <Row cols={1}>
                        <SelectField label="Shift" name="shiftId" required={!client} defaultValue={copy?.shiftId ?? ""}>
                          <option value="">Choose a shift</option>
                          {shifts.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name} ({fmtTime(s.startTime)} – {fmtTime(s.endTime)})
                            </option>
                          ))}
                        </SelectField>
                      </Row>
                    </Block>

                    <Block label="Pay rate">
                      <Row>
                        <div className={styles.field}>
                          <span className={styles.fieldLabel}>Pay Method</span>
                          <input type="hidden" name="payType" value={payType} />
                          <SegmentedControl
                            ariaLabel="Pay method"
                            fullWidth
                            items={[
                              { value: "HOURLY", label: "Hourly" },
                              { value: "SALARY", label: "Salary" },
                              { value: "", label: "Not set" },
                            ]}
                            value={payType}
                            onChange={setPayType}
                          />
                        </div>
                        <Input
                          label={payType === "HOURLY" ? "Pay Rate (per hour)" : payType === "SALARY" ? "Pay Rate (per year)" : "Pay Rate"}
                          name="payRate"
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          leadingIcon={<span className={styles.unit}>$</span>}
                        />
                      </Row>
                    </Block>

                    <Block label="Payroll" note="Used when their hours are sent to payroll.">
                      <Row cols={3}>
                        <SelectField label="Pay Category" name="payCategoryId" required={!client} defaultValue={copy?.payCategoryId ?? ""}>
                          <option value="">Choose a pay category</option>
                          {payCategories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.number}{c.description ? ` (${c.description})` : ""}
                            </option>
                          ))}
                        </SelectField>
                        <SelectField label="Pay Type" name="payTypeId" defaultValue={copy?.payTypeId ?? ""}>
                          <option value="">None</option>
                          {payTypes.map((pt) => (
                            <option key={pt.id} value={pt.id}>
                              {pt.number}{pt.description ? ` (${pt.description})` : ""}
                            </option>
                          ))}
                        </SelectField>
                        <Input label="ADP Worker ID" name="adpWorkerId" autoComplete="off" />
                      </Row>
                    </Block>
                    </fieldset>
                  </div>

                  {/* ── 3. Personal details ── */}
                  <div data-step="personal" style={panelStyle("personal")}>
                    <Block label="Contact" note="Optional. These can also be added later from their profile.">
                      <Row>
                        <Input label="Phone 1" name="phone" type="tel" />
                        <Input label="Phone 2" name="phone2" type="tel" />
                      </Row>
                    </Block>

                    <Block label="Emergency contact">
                      <Row cols={3}>
                        <Input label="Contact Name" name="emergencyContact" />
                        <Input label="Contact Phone" name="emergencyPhone" type="tel" />
                        <Input label="Relationship" name="emergencyRelationship" placeholder="For example, spouse" />
                      </Row>
                    </Block>

                    <Block label="Address">
                      <Row>
                        <Input label="Address Line 1" name="address1" />
                        <Input label="Address Line 2" name="address2" />
                      </Row>
                      <Row cols={4}>
                        <Input label="City" name="city" />
                        <Input label="State / Province" name="state" />
                        <Input label="Zip Code" name="zipCode" />
                        <Input label="Country" name="country" />
                      </Row>
                    </Block>

                    <Block label="About">
                      <Row>
                        <Input label="Gender" name="gender" />
                        <SelectField label="Marital Status" name="maritalStatus">
                          <option value="">Not specified</option>
                          <option value="Single">Single</option>
                          <option value="Married">Married</option>
                          <option value="Divorced">Divorced</option>
                          <option value="Widowed">Widowed</option>
                          <option value="Other">Other</option>
                        </SelectField>
                      </Row>
                      {/* Informational for now (lib/languages.ts). */}
                      <Row>
                        <SelectField label="Preferred Language" name="preferredLanguage" defaultValue="">
                          <option value="">Not specified</option>
                          {LANGUAGES.map((l) => (
                            <option key={l.code} value={l.code}>{l.name}</option>
                          ))}
                        </SelectField>
                      </Row>
                    </Block>
                  </div>
                </div>
              </div>

              <footer className={styles.foot}>
                <span className={styles.footHint} data-ready={onLast && missing.length === 0} aria-live="polite">
                  {onLast ? (
                    missing.length === 0 ? (
                      <>
                        <CircleCheck aria-hidden="true" />
                        Ready to create.
                      </>
                    ) : (
                      `Still needed: ${listOf(missing.map((m) => m.label))}.`
                    )
                  ) : missing.some((m) => m.step === step) ? (
                    `Still needed: ${listOf(missing.filter((m) => m.step === step).map((m) => m.label))}.`
                  ) : null}
                </span>
                <span className={`${styles.footActions} ta-sheet-actions`}>
                  {prevStep ? (
                    <Button type="button" hierarchy="secondary" onClick={() => goTo(prevStep.value)}>
                      Back
                    </Button>
                  ) : (
                    <Button type="button" hierarchy="secondary" onClick={handleClose}>
                      Cancel
                    </Button>
                  )}
                  {onLast ? (
                    <Button type="submit" disabled={isPending}>
                      {isPending ? "Creating…" : "Create employee"}
                    </Button>
                  ) : (
                    <Button type="button" onClick={handleContinue}>
                      Continue
                    </Button>
                  )}
                </span>
              </footer>
            </form>
          </div>
        </Overlay>
      )}
    </>
  );
}
