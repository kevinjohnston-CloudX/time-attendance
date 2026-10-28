"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode, type SelectHTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { createEmployee, getSupervisorOptions } from "@/actions/admin.actions";
import type { CopyFromEmployee } from "@/lib/employee-copy";
import type { Site, Department, RuleSet } from "@prisma/client";
import { Banner, Button, Input, SegmentedControl, Select } from "@/components/ui";
import { Overlay } from "@/components/ui/overlay";
import { BriefcaseBusiness, Check, CircleCheck, Plus, UserPlus, UserRound, Wallet, X } from "lucide-react";
import styles from "./new-employee-window.module.css";

/**
 * "Add Employee" — the design's primary action on the employee list.
 *
 * <p>The design opens the empty doc screen for this; here it stays a modal,
 * because the record cannot exist until it has a site, a department and a rule
 * set, and a half-filled employee page with no id to save against would need a
 * draft state the server has no concept of.
 *
 * <p>The window follows the Export window on Live Attendance: a grey frame, a
 * rail and a form card. The rail shows the person as the record will, and the
 * three parts of the record with what each still needs, so a required field on
 * a part nobody opened is never a mystery.
 *
 * <p>The parts are visual only — every field stays mounted, so one submit sends
 * the whole record. Hiding a part must not drop the fields on it; a new hire
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

type Part = "job" | "pay" | "personal";

const PARTS: { value: Part; title: string; short: string; line: string; icon: ReactNode; heading: string; intro: string }[] = [
  {
    value: "job",
    title: "Job and badge",
    short: "Job",
    line: "Name, badge, sign in, team",
    icon: <BriefcaseBusiness aria-hidden="true" />,
    heading: "Job and badge",
    intro: "Who they are, how they sign in, and where they work.",
  },
  {
    value: "pay",
    title: "Pay and schedule",
    short: "Pay",
    line: "Rule set, shift, pay rate",
    icon: <Wallet aria-hidden="true" />,
    heading: "Pay and schedule",
    intro: "How their hours are counted and paid.",
  },
  {
    value: "personal",
    title: "Personal details",
    short: "Personal",
    line: "Phone and address",
    icon: <UserRound aria-hidden="true" />,
    heading: "Personal details",
    intro: "Optional. These can also be added later from their profile.",
  },
];

/** The fields the server refuses to save without, and the part each sits on. */
type Snapshot = {
  name: string;
  hireDate: string;
  wmsId: string;
  workEmail: string;
  email: string;
  departmentId: string;
  ruleSetId: string;
  jobTitleId: string;
};

const NEEDED: { part: Part; label: string; missing: (s: Snapshot) => boolean }[] = [
  { part: "job", label: "full name", missing: (s) => !s.name.trim() },
  { part: "job", label: "hire date", missing: (s) => !s.hireDate },
  { part: "job", label: "badge ID", missing: (s) => !s.wmsId.trim() },
  { part: "job", label: "a work or personal email", missing: (s) => !s.workEmail.trim() && !s.email.trim() },
  { part: "job", label: "department", missing: (s) => !s.departmentId },
  { part: "pay", label: "rule set", missing: (s) => !s.ruleSetId },
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
  customRoles: { id: string; name: string }[];
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
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  const fieldId = id ?? `c-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className={`${styles.field} ${className ?? ""}`}>
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

/** A group of fields inside the form card, under a quiet label. */
function Block({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <section className={styles.block}>
      <h4 className={styles.blockLabel}>{label}</h4>
      <div className={styles.grid}>{children}</div>
      {note && <p className={styles.blockNote}>{note}</p>}
    </section>
  );
}

export function CreateEmployeeForm({ sites, departments, ruleSets, employees, customRoles, shifts, holidayRules, payCategories, payTypes, jobTitles, agencies, copyFrom }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copy, setCopy] = useState<CopyFromEmployee | null>(copyFrom ?? null);
  const [open, setOpen] = useState(!!copyFrom);
  const [part, setPart] = useState<Part>("job");
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

  const defaultSiteId =
    sites.find((s) => departments.some((d) => d.sites.some((ds) => ds.site.id === s.id)))?.id ?? sites[0]?.id ?? "";
  const [payType, setPayType] = useState<string>(copyFrom ? (copyFrom.payType ?? "") : "HOURLY");
  const [selectedSiteId, setSelectedSiteId] = useState(copyFrom?.siteId ?? defaultSiteId);
  const filteredDepts = departments.filter((d) => d.sites.some((ds) => ds.site.id === selectedSiteId));
  const activeAgencies = agencies.filter((a) => !a.inactiveOn || new Date(a.inactiveOn) > new Date());

  // What the rail and the footer read. The fields stay uncontrolled; this is
  // read back from the form whenever one of them changes.
  const blankSnapshot = (c: CopyFromEmployee | null, siteId: string): Snapshot => ({
    name: "",
    hireDate: "",
    wmsId: "",
    workEmail: "",
    email: "",
    // A required select with no empty option shows, and sends, its first one.
    departmentId:
      c?.departmentId ?? departments.find((d) => d.sites.some((ds) => ds.site.id === siteId))?.id ?? "",
    ruleSetId: c?.ruleSetId ?? ruleSets[0]?.id ?? "",
    jobTitleId: c?.jobTitleId ?? "",
  });
  const [snap, setSnap] = useState<Snapshot>(() => blankSnapshot(copyFrom ?? null, copyFrom?.siteId ?? defaultSiteId));

  function readForm() {
    const f = formRef.current;
    if (!f) return;
    const fd = new FormData(f);
    const v = (k: string) => (fd.get(k) as string | null) ?? "";
    setSnap({
      name: v("name"),
      hireDate: v("hireDate"),
      wmsId: v("wmsId"),
      workEmail: v("workEmail"),
      email: v("email"),
      departmentId: v("departmentId"),
      ruleSetId: v("ruleSetId"),
      jobTitleId: v("jobTitleId"),
    });
  }

  function handleClose() {
    setOpen(false);
    // A list that failed to load is asked for again on the next open.
    setSupervisorsFailed(false);
    setPart("job");
    setError(null);
    if (copy) {
      // The next Add Employee starts blank, and a refresh does not reopen the copy.
      setCopy(null);
      setSelectedSiteId(defaultSiteId);
      setPayType("HOURLY");
      setSnap(blankSnapshot(null, defaultSiteId));
      const url = new URL(window.location.href);
      url.searchParams.delete("copyFrom");
      router.replace(url.pathname + url.search);
    } else {
      setSnap(blankSnapshot(null, selectedSiteId));
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

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
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
        email: fd.get("email") as string,
        workEmail: fd.get("workEmail") as string,
        employeeCode: (fd.get("employeeCode") as string) || "",
        role,
        customRoleId,
        siteId: fd.get("siteId") as string,
        departmentId: fd.get("departmentId") as string,
        ruleSetId: fd.get("ruleSetId") as string,
        hireDate: fd.get("hireDate") as string,
        supervisorId: fd.get("supervisorId") as string,
        wmsId: fd.get("wmsId") as string,
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
   * A part's panel.
   *
   * <p>The inactive parts are switched off in an inline style, not with a
   * `hidden` class. They stay in the DOM either way: `display: none` fields
   * are still submitted, and dropping them would create employees with no pay
   * category.
   */
  const invalidShown = useRef(false);
  const panelStyle = (p: Part): React.CSSProperties => ({ display: part === p ? "block" : "none" });

  const missing = NEEDED.filter((n) => n.missing(snap));
  const missingOn = (p: Part) => missing.filter((n) => n.part === p).length;
  const partIndex = PARTS.findIndex((p) => p.value === part);
  const nextPart = PARTS[partIndex + 1];
  const current = PARTS[partIndex];

  const siteName = sites.find((s) => s.id === selectedSiteId)?.name ?? "";
  const deptName = departments.find((d) => d.id === snap.departmentId)?.name ?? "";
  const jobName = jobTitles.find((j) => j.id === snap.jobTitleId)?.name ?? "";
  const initials = initialsOf(snap.name);
  const startDate = snap.hireDate ? format(parseISO(snap.hireDate), "MMM d, yyyy") : "";

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
              <span className={styles.glyph} aria-hidden="true">
                <UserPlus />
              </span>
              <span className={styles.titles}>
                <h2 id="new-employee-title" className={styles.title}>
                  New employee
                </h2>
                <span className={`${styles.subtitle} truncate`}>
                  {copy
                    ? `Setup copied from ${copy.sourceName}. Name, emails, badge, hire date, personal details and pay rate start blank.`
                    : "Start with the job and badge. Pay and personal details can follow."}
                </span>
              </span>
              <Button hierarchy="tertiary" size="sm" iconOnly onClick={handleClose} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </header>

            {/* One form: the parts only hide fields, they never unmount them. */}
            <form
              ref={formRef}
              className={styles.form}
              onSubmit={handleSubmit}
              onChange={readForm}
              // Saved with a required field empty on a part that is not open,
              // the browser refuses without showing why. Open that part, then
              // let the browser point at the field.
              onInvalidCapture={(e) => {
                const field = e.target as HTMLInputElement;
                if (invalidShown.current) return;
                invalidShown.current = true;
                const p = field.closest<HTMLElement>("[data-part]")?.dataset.part as Part | undefined;
                if (p) setPart(p);
                requestAnimationFrame(() => {
                  invalidShown.current = false;
                  field.reportValidity();
                });
              }}
            >
              <div className={styles.body}>
                {/* ── The rail ─────────────────────────────────────────── */}
                <aside className={styles.rail} aria-label="New employee summary">
                  <div className={styles.person}>
                    <div className={styles.personTop}>
                      <span className={styles.avatar} data-empty={!initials} aria-hidden="true">
                        {initials || <UserRound />}
                      </span>
                      <span className={styles.personText}>
                        <span className={styles.personName} data-empty={!snap.name.trim()}>
                          {snap.name.trim() || "New employee"}
                        </span>
                        <span className={styles.personJob}>{jobName || "No job title yet"}</span>
                      </span>
                    </div>
                    <dl className={styles.facts}>
                      <div className={`${styles.fact} ${styles.badgeFact}`}>
                        <dt>Badge ID</dt>
                        <dd data-empty={!snap.wmsId.trim()}>{snap.wmsId.trim() || "Not set"}</dd>
                      </div>
                      <div className={styles.fact}>
                        <dt>Department</dt>
                        <dd data-empty={!deptName} title={deptName}>{deptName || "Not set"}</dd>
                      </div>
                      <div className={styles.fact}>
                        <dt>Site</dt>
                        <dd data-empty={!siteName} title={siteName}>{siteName || "Not set"}</dd>
                      </div>
                      <div className={styles.fact}>
                        <dt>Starts</dt>
                        <dd data-empty={!startDate}>{startDate || "Not set"}</dd>
                      </div>
                    </dl>
                  </div>

                  <nav className={styles.parts} aria-label="Parts of the record">
                    {PARTS.map((p) => {
                      const left = missingOn(p.value);
                      const optional = !NEEDED.some((n) => n.part === p.value);
                      return (
                        <button
                          key={p.value}
                          type="button"
                          className={styles.part}
                          aria-current={part === p.value ? "true" : undefined}
                          onClick={() => setPart(p.value)}
                        >
                          <span className={styles.partIcon}>{p.icon}</span>
                          <span className={styles.partText}>
                            <span className={styles.partTitle}>
                              <span className={styles.long}>{p.title}</span>
                              <span className={styles.short}>{p.short}</span>
                            </span>
                            <span className={styles.partLine}>{p.line}</span>
                          </span>
                          {optional ? (
                            <span className={styles.status} data-tone="optional">Optional</span>
                          ) : left > 0 ? (
                            <span className={styles.status} data-tone="needs" aria-label={`${left} still needed`}>
                              {left}
                            </span>
                          ) : (
                            <span className={styles.status} data-tone="done" aria-label="Complete">
                              <Check strokeWidth={3} aria-hidden="true" />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </nav>
                </aside>

                {/* ── The form card ────────────────────────────────────── */}
                <div className={`ta-scroll ${styles.card}`}>
                  <div className={styles.cardHead}>
                    <h3 className={styles.cardTitle}>{current.heading}</h3>
                    <p className={styles.cardLine}>{current.intro}</p>
                  </div>

                  {error && (
                    <div className={styles.banner}>
                      <Banner tone="error" body={error} />
                    </div>
                  )}

                  {/* ── Job and badge ── */}
                  <div data-part="job" style={panelStyle("job")}>
                    <Block label="Person">
                      <div className={styles.wide}>
                        <Input label="Full Name" name="name" required autoComplete="off" />
                      </div>
                      <Input label="Hire Date" name="hireDate" type="date" required />
                      <Input label="Badge ID (WMS)" name="wmsId" placeholder="The number on their QR badge" required autoComplete="off" />
                    </Block>

                    {/* Either email signs the person in (password or Google); at
                        least one is needed, which the save says if both are blank. */}
                    <Block label="Sign in" note="At least one email is needed. Invites go to the work email first.">
                      <Input label="Work Email" name="workEmail" type="email" autoComplete="off" />
                      <Input label="Personal Email" name="email" type="email" autoComplete="off" />
                      <SelectField label="Role" name="role" defaultValue={copy?.role} className={styles.wide}>
                        {BUILTIN_ROLES.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                        {customRoles.map((r) => (
                          <option key={r.id} value={`custom:${r.id}`}>{r.name}</option>
                        ))}
                      </SelectField>
                    </Block>

                    <Block label="Placement">
                      <SelectField
                        label="Site"
                        name="siteId"
                        value={selectedSiteId}
                        onChange={(e) => {
                          setSelectedSiteId(e.target.value);
                          // The department list changes with the site; read it
                          // back once the new options are in.
                          requestAnimationFrame(readForm);
                        }}
                      >
                        {sites.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </SelectField>

                      <SelectField label="Department" name="departmentId" required defaultValue={copy?.departmentId}>
                        {filteredDepts.map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </SelectField>

                      {supervisors ? (
                        <SelectField label="Supervisor" name="supervisorId" defaultValue={copy?.supervisorId ?? ""}>
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

                      <SelectField label="Job Title" name="jobTitleId" defaultValue={copy?.jobTitleId ?? ""}>
                        <option value="">None</option>
                        {jobTitles.map((jt) => (
                          <option key={jt.id} value={jt.id}>
                            {jt.name}{jt.externalId ? ` (${jt.externalId})` : ""}
                          </option>
                        ))}
                      </SelectField>
                      {/* Agencies past their inactive date stay on file for the
                          people already in them, but are not offered for new hires. */}
                      <SelectField label="Agency" name="agencyId" defaultValue={copy?.agencyId ?? ""} className={styles.wide}>
                        <option value="">None</option>
                        {activeAgencies.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} ({a.description})
                          </option>
                        ))}
                      </SelectField>
                    </Block>
                  </div>

                  {/* ── Pay and schedule ── */}
                  <div data-part="pay" style={panelStyle("pay")}>
                    <Block label="Time rules">
                      <SelectField label="Rule Set" name="ruleSetId" required defaultValue={copy?.ruleSetId}>
                        {ruleSets.map((rs) => (
                          <option key={rs.id} value={rs.id}>{rs.name}</option>
                        ))}
                      </SelectField>
                      <SelectField label="Holiday Rule" name="holidayRuleId" defaultValue={copy?.holidayRuleId ?? ""}>
                        <option value="">None</option>
                        {holidayRules.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </SelectField>
                      <SelectField label="Shift" name="shiftId" defaultValue={copy?.shiftId ?? ""} className={styles.wide}>
                        <option value="">None</option>
                        {shifts.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({fmtTime(s.startTime)} – {fmtTime(s.endTime)})
                          </option>
                        ))}
                      </SelectField>
                    </Block>

                    <Block label="Pay">
                      <div className={`${styles.field} ${styles.wide}`}>
                        <span className={styles.fieldLabel} id="c-pay-method">Pay Method</span>
                        <input type="hidden" name="payType" value={payType} />
                        <SegmentedControl
                          ariaLabel="Pay method"
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
                      <SelectField label="Pay Category" name="payCategoryId" defaultValue={copy?.payCategoryId ?? ""}>
                        <option value="">None</option>
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
                      <Input label="ADP Worker ID" name="adpWorkerId" placeholder="From ADP Workforce Now" autoComplete="off" />
                    </Block>
                  </div>

                  {/* ── Personal details ── */}
                  <div data-part="personal" style={panelStyle("personal")}>
                    <Block label="Contact">
                      <Input label="Phone 1" name="phone" type="tel" />
                      <Input label="Phone 2" name="phone2" type="tel" />
                    </Block>

                    <Block label="Emergency contact">
                      <Input label="Contact Name" name="emergencyContact" />
                      <Input label="Contact Phone" name="emergencyPhone" type="tel" />
                      <Input label="Relationship" name="emergencyRelationship" placeholder="For example, spouse" />
                    </Block>

                    <Block label="Address">
                      <div className={styles.wide}>
                        <Input label="Address Line 1" name="address1" />
                      </div>
                      <div className={styles.wide}>
                        <Input label="Address Line 2" name="address2" />
                      </div>
                      <Input label="City" name="city" />
                      <Input label="State / Province" name="state" />
                      <Input label="Zip Code" name="zipCode" />
                      <Input label="Country" name="country" />
                    </Block>

                    <Block label="About">
                      <Input label="Gender" name="gender" />
                      <SelectField label="Marital Status" name="maritalStatus">
                        <option value="">Not specified</option>
                        <option value="Single">Single</option>
                        <option value="Married">Married</option>
                        <option value="Divorced">Divorced</option>
                        <option value="Widowed">Widowed</option>
                        <option value="Other">Other</option>
                      </SelectField>
                    </Block>
                  </div>
                </div>
              </div>

              <footer className={styles.foot}>
                <span className={styles.footHint} data-ready={missing.length === 0} aria-live="polite">
                  {missing.length === 0 ? (
                    <>
                      <CircleCheck aria-hidden="true" />
                      Ready to create.
                    </>
                  ) : (
                    `Still needed: ${listOf(missing.map((m) => m.label))}.`
                  )}
                </span>
                <span className={`${styles.footActions} ta-sheet-actions`}>
                  <Button type="button" hierarchy="tertiary" onClick={handleClose}>
                    Cancel
                  </Button>
                  {nextPart && (
                    <Button type="button" hierarchy="secondary" className={styles.next} onClick={() => setPart(nextPart.value)}>
                      Next: {nextPart.title}
                    </Button>
                  )}
                  <Button type="submit" disabled={isPending}>
                    {isPending ? "Creating…" : "Create employee"}
                  </Button>
                </span>
              </footer>
            </form>
          </div>
        </Overlay>
      )}
    </>
  );
}
