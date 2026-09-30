"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { updateEmployee, updateHrSiteAccess } from "@/actions/admin.actions";
import { setTemporaryPassword } from "@/actions/password.actions";
import type { Site, Department, RuleSet, Employee } from "@prisma/client";
import {
  Banner,
  Button,
  Checkbox,
  EmptyState,
  Input,
  LinkButton,
  PageHeader,
  PinnedBar,
  SegmentedControl,
  Select,
  Toast,
  useToast,
} from "@/components/ui";
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Camera,
  Building2,
  CircleDollarSign,
  ContactRound,
  History,
  KeyRound,
  Pencil,
  ScanLine,
  Wallet,
} from "lucide-react";
import { useBreadcrumbLeaf } from "@/components/layout/breadcrumb-leaf";
import { PhotoViewer, ZoomableFace } from "@/components/presence/face";
import { PhotoEditor } from "@/components/presence/photo-editor";
import styles from "./employee-record.module.css";

/**
 * The employee record. It opens to read: every section shows its values as
 * text, and one Edit button turns each value into its field where it stands.
 * Save changes writes the whole record at once; Cancel puts every field back.
 *
 * <p>One save, but not one overwrite. Only the fields that were actually
 * changed are sent, so on a record two people edit in the same afternoon a
 * one-field correction still only touches that field. That also keeps two
 * side effects honest: the badge barcode is marked as set by hand (so the
 * Oracle sync leaves it alone) only when somebody changed the barcode, and
 * the adjusted hire date is only written when somebody changed it.
 *
 * <p>Site access is its own call on the server, so it goes second, and only
 * when the checked sites differ from what was saved.
 */

/**
 * The user fields this form draws. Deliberately not Prisma's `User`, which
 * also carries the password hash: typing it that way is what let the whole
 * row be selected and serialised into the page.
 */
type UserSummary = { id: string; name: string | null; email: string | null };

type EmployeeWithRelations = Omit<Employee, "payRate"> & {
  payRate: number | null;
  user: UserSummary;
  site: Site;
  department: Department;
  ruleSet: RuleSet;
  supervisor: (Omit<Employee, "payRate"> & { payRate: number | null; user: UserSummary }) | null;
};

interface Props {
  employee: EmployeeWithRelations;
  /** A signed link to the time clock tablet's photo, or null for initials. */
  photo: string | null;
  /** Whether this viewer may replace the photo (PRESENCE_PHOTO_EDIT). */
  canEditPhoto: boolean;
  sites: Site[];
  departments: (Department & { sites: { site: Site }[] })[];
  ruleSets: RuleSet[];
  employees: { id: string; user: { name: string | null } }[];
  customRoles: { id: string; name: string; isSystem: boolean; rank: number; liveAttendanceOnly?: boolean }[];
  shifts: { id: string; name: string; startTime: string; endTime: string }[];
  holidayRules: { id: string; name: string }[];
  payCategories: { id: string; number: number; description: string | null }[];
  payTypes: { id: string; number: number; description: string | null }[];
  logs: Array<{
    id: string;
    createdAt: string;
    actorName: string;
    fields: Array<{ field: string; before: string; after: string }>;
  }>;
  hrSiteAccess: string[];
  actorRole: string;
}

const SYSTEM_ROLE_NAME: Record<string, string> = {
  EMPLOYEE: "Employee",
  SUPERVISOR: "Supervisor",
  PAYROLL_ADMIN: "Payroll Admin",
  HR_ADMIN: "HR Admin",
  SYSTEM_ADMIN: "System Admin",
  SUPER_ADMIN: "Super Admin",
};

const MARITAL = ["Single", "Married", "Divorced", "Widowed", "Other"];

/** Every value the record edits, as the text its field holds. */
type Values = {
  name: string;
  email: string;
  jobTitle: string;
  customRoleId: string;
  siteId: string;
  departmentId: string;
  supervisorId: string;
  status: "active" | "on-leave" | "inactive";
  terminationReason: string;
  adjustedHireDate: string;
  wmsId: string;
  barcode: string;
  adpWorkerId: string;
  ruleSetId: string;
  shiftId: string;
  holidayRuleId: string;
  payCategoryId: string;
  payTypeId: string;
  payType: string;
  payRate: string;
  gender: string;
  maritalStatus: string;
  phone: string;
  phone2: string;
  emergencyContact: string;
  emergencyPhone: string;
  emergencyRelationship: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
};

type Key = keyof Values;

function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function initialsOf(name: string | null): string {
  const words = (name ?? "").replace(/[^\p{L}\s'-]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0] ?? "";
  const last = words.length > 1 ? words[words.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

const numbered = (c: { number: number; description: string | null }) =>
  `${c.number}${c.description ? ` · ${c.description}` : ""}`;

/** The audit log writes an empty side as a dash; a person reads "Empty". */
const shown = (v: string) => (v === "—" || v === "" ? "Empty" : v);

/** A pay code as the payroll team reads it: its number in a small mono tag, then its name. */
function Coded({ item }: { item: { number: number; description: string | null } }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className={styles.code}>{item.number}</span>
      {item.description && <span className="min-w-0">{item.description}</span>}
    </span>
  );
}

/** Whether the record is in edit mode, for the field and section helpers. */
const Editing = createContext(false);

/** One field: its value as text in read mode, its control in edit mode. */
function Field({
  label,
  htmlFor,
  read,
  children,
  hint,
  readHint,
  required,
  mono,
  className,
}: {
  label: string;
  htmlFor?: string;
  read: ReactNode;
  children: ReactNode;
  hint?: string;
  /** Shown under the value in read mode too, when it says something about the value. */
  readHint?: string;
  required?: boolean;
  mono?: boolean;
  className?: string;
}) {
  const editing = useContext(Editing);
  const empty = read === "" || read == null;
  return (
    <div className={`${styles.field}${className ? ` ${className}` : ""}`}>
      {editing ? (
        <label htmlFor={htmlFor} className={styles.label}>
          {label}
          {required && <span className={styles.required} aria-hidden="true">*</span>}
        </label>
      ) : (
        <span className={styles.label}>{label}</span>
      )}
      <div className={styles.valueCol}>
        {editing ? (
          children
        ) : (
          <span className={`${styles.value}${mono && !empty ? ` ${styles.mono}` : ""}`} data-empty={empty ? "true" : undefined}>
            {empty ? "Not set" : read}
          </span>
        )}
        {editing ? hint && <span className={styles.hint}>{hint}</span> : readHint && <span className={styles.hint}>{readHint}</span>}
      </div>
    </div>
  );
}

/** A section card with its icon, title and one quiet line; its body switches to fields while editing. */
function Section({
  title,
  subtitle,
  icon: Icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: React.ElementType;
  children: ReactNode;
}) {
  const editing = useContext(Editing);
  return (
    <section className={styles.card} data-editing={editing ? "true" : undefined} aria-label={title}>
      <header className={styles.sectionHead}>
        <span className={styles.sectionIcon} aria-hidden="true">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 className={styles.sectionTitle}>{title}</h2>
          {subtitle && <p className={styles.sectionSub}>{subtitle}</p>}
        </div>
      </header>
      <div className={`${styles.sectionBody}${editing ? ` ${styles.editing}` : ""}`}>{children}</div>
    </section>
  );
}

export function EditEmployeeForm({
  employee,
  photo: photoFromServer,
  canEditPhoto,
  sites,
  departments,
  ruleSets,
  employees,
  customRoles,
  shifts,
  holidayRules,
  payCategories,
  payTypes,
  logs,
  hrSiteAccess,
  actorRole,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  // The top bar's trail ends on this person: Administration, Employees, their name.
  useBreadcrumbLeaf(employee.user.name ?? employee.employeeCode);
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [tempPassword, setTempPasswordValue] = useState("");
  const [tempStatus, setTempStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [tempMessage, setTempMessage] = useState("");
  const [logField, setLogField] = useState("");
  const [logDays, setLogDays] = useState(0);
  const [zoomed, setZoomed] = useState<string | null>(null);
  const [editingPhoto, setEditingPhoto] = useState(false);
  // The photo just saved here, until the server's own link catches up.
  const [photoSaved, setPhotoSaved] = useState<{ url: string | null } | null>(null);
  const photo = photoSaved ? photoSaved.url : photoFromServer;

  // Site access section is only shown when the employee being edited is HR_ADMIN or SYSTEM_ADMIN
  const employeeIsHrOrSysAdmin = ["HR_ADMIN", "SYSTEM_ADMIN"].includes(employee.role);
  // Only HR_ADMIN / SYSTEM_ADMIN actors can manage site access
  const canManageSiteAccess = ["HR_ADMIN", "SYSTEM_ADMIN"].includes(actorRole);

  // The role the record is on: its custom role, else the system role of the
  // same name. The select has no empty option, so this is also what it shows.
  const roleId =
    employee.customRoleId ??
    customRoles.find((r) => r.isSystem && r.name === SYSTEM_ROLE_NAME[employee.role])?.id ??
    customRoles[0]?.id ??
    "";

  const saved: Values = useMemo(
    () => ({
      name: employee.user.name ?? "",
      email: employee.user.email ?? "",
      jobTitle: employee.jobTitle ?? "",
      customRoleId: roleId,
      siteId: employee.siteId,
      departmentId: employee.departmentId,
      supervisorId: employee.supervisorId ?? "",
      status: !employee.isActive ? "inactive" : employee.onLeave ? "on-leave" : "active",
      terminationReason: employee.terminationReason ?? "",
      adjustedHireDate: employee.adjustedHireDate ? format(employee.adjustedHireDate, "yyyy-MM-dd") : "",
      wmsId: employee.wmsId ?? "",
      barcode: employee.barcode ?? "",
      adpWorkerId: employee.adpWorkerId ?? "",
      ruleSetId: employee.ruleSetId,
      shiftId: employee.shiftId ?? "",
      holidayRuleId: employee.holidayRuleId ?? "",
      payCategoryId: employee.payCategoryId ?? "",
      payTypeId: employee.payTypeId ?? "",
      payType: employee.payType ?? "HOURLY",
      payRate: employee.payRate != null ? String(Number(employee.payRate)) : "",
      gender: employee.gender ?? "",
      maritalStatus: employee.maritalStatus ?? "",
      phone: employee.phone ?? "",
      phone2: employee.phone2 ?? "",
      emergencyContact: employee.emergencyContact ?? "",
      emergencyPhone: employee.emergencyPhone ?? "",
      emergencyRelationship: employee.emergencyRelationship ?? "",
      address1: employee.address1 ?? "",
      address2: employee.address2 ?? "",
      city: employee.city ?? "",
      state: employee.state ?? "",
      zipCode: employee.zipCode ?? "",
      country: employee.country ?? "",
    }),
    [employee, roleId],
  );
  const savedAccess = useMemo(() => new Set(hrSiteAccess), [hrSiteAccess]);

  const [draft, setDraft] = useState<Values>(saved);
  const [draftAccess, setDraftAccess] = useState<Set<string>>(savedAccess);

  // Read mode always shows what is saved; edit mode shows the draft.
  const v = editing ? draft : saved;
  const access = editing ? draftAccess : savedAccess;
  // An account on a role limited to Live Attendance gets the same section: its
  // ticked buildings are the ones its Live Attendance can switch between.
  // Read off the role in the form, so picking that role shows it at once.
  const limitedToLiveAttendance = customRoles.find((r) => r.id === v.customRoleId)?.liveAttendanceOnly ?? false;
  const showsSiteAccess = employeeIsHrOrSysAdmin || limitedToLiveAttendance;

  const changed = (Object.keys(saved) as Key[]).filter((k) => draft[k] !== saved[k]);
  const accessChanged =
    canManageSiteAccess &&
    showsSiteAccess &&
    (draftAccess.size !== savedAccess.size || [...draftAccess].some((id) => !savedAccess.has(id)));
  const changeCount = changed.length + (accessChanged ? 1 : 0);
  const dirty = editing && changeCount > 0;

  // Leaving the page with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // The rail pins just under the page bar, and never taller than the window
  // leaves it, so its top and its button are always on screen. Measured
  // before the first paint and again whenever the bar or the window changes.
  // Where the bar itself does not pin (a short or narrow window), the rail
  // does not leave room for it. Until measured, the stylesheet's offset holds.
  const barRef = useRef<HTMLDivElement | null>(null);
  const [railPin, setRailPin] = useState<{ top: number; maxHeight: number } | null>(null);
  useLayoutEffect(() => {
    const first = barRef.current;
    if (!first) return;
    let scroller: HTMLElement | null = first.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const measure = () => {
      // Read fresh every time: a hot reload can swap the bar's element, and a
      // detached one reports no position at all.
      const bar = barRef.current;
      if (!bar || !bar.isConnected) return;
      const pinned = getComputedStyle(bar).position === "sticky";
      // The same distance the sections start below the bar (the page's gap
      // less the bar's negative bottom margin), so the card and the first
      // section share one top line whether or not the page has scrolled.
      const below =
        parseFloat(getComputedStyle(bar.parentElement ?? bar).rowGap || "0") +
        parseFloat(getComputedStyle(bar).marginBottom || "0");
      const top = pinned ? Math.round(bar.getBoundingClientRect().height + below) : 16;
      const view = scroller?.clientHeight ?? window.innerHeight;
      // Less the rail's own 4px of shadow room on each side.
      const next = { top: top - 4, maxHeight: Math.max(240, view - top - 16) + 8 };
      setRailPin((prev) => (prev && prev.top === next.top && prev.maxHeight === next.maxHeight ? prev : next));
    };
    // Scrolling checks again too (once a frame, and only re-rendering when a
    // number moved), so a reading taken while the bar was not pinned can
    // never leave the card under it.
    let frame = 0;
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); });
    };
    measure();
    window.addEventListener("resize", measure);
    (scroller ?? window).addEventListener("scroll", onScroll, { passive: true });
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    ro?.observe(first);
    if (scroller) ro?.observe(scroller);
    return () => {
      window.removeEventListener("resize", measure);
      (scroller ?? window).removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      ro?.disconnect();
    };
  }, []);

  function set<K extends Key>(key: K, value: Values[K]) {
    setDraft((d) => {
      const next = { ...d, [key]: value };
      // A department only exists at some sites. Moving site keeps the
      // department when the new site has it, and otherwise takes the first
      // one the new site offers, as the list below shows.
      if (key === "siteId") {
        const offered = departments.filter((dep) => dep.sites.some((ds) => ds.site.id === value));
        if (!offered.some((dep) => dep.id === next.departmentId)) next.departmentId = offered[0]?.id ?? "";
      }
      return next;
    });
  }

  function startEditing() {
    setDraft(saved);
    setDraftAccess(new Set(savedAccess));
    setError(null);
    setEditing(true);
  }

  function cancel() {
    if (dirty && !window.confirm("Discard your unsaved changes?")) return;
    setEditing(false);
    setError(null);
  }

  function payload() {
    const out: Record<string, unknown> = { employeeId: employee.id };
    for (const k of changed) {
      const val = draft[k];
      switch (k) {
        case "status":
          out.isActive = val !== "inactive";
          out.onLeave = val === "on-leave";
          break;
        case "payRate":
          out.payRate = val ? parseFloat(val) : null;
          break;
        case "customRoleId":
        case "supervisorId":
        case "shiftId":
        case "holidayRuleId":
        case "payCategoryId":
        case "payTypeId":
        case "adjustedHireDate":
          out[k] = val || null;
          break;
        default:
          out[k] = val;
      }
    }
    return out;
  }

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (changeCount === 0) {
      setEditing(false);
      return;
    }
    if (!draft.departmentId) {
      setError("Pick a department. The site you chose has none linked to it yet.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await write();
      } catch {
        setError("The changes could not be saved. Check the connection and try again.");
      }
    });
  }

  /** Writes the record, then site access. Returns early with a message on a refusal. */
  async function write() {
    if (changed.length > 0) {
      const result = await updateEmployee(payload() as Parameters<typeof updateEmployee>[0]);
      if (!result.success) {
        setError(result.error);
        return;
      }
    }
    if (accessChanged) {
      const result = await updateHrSiteAccess({ employeeId: employee.id, siteIds: Array.from(draftAccess) });
      if (!result.success) {
        setError(
          changed.length > 0
            ? `The record was saved, but site access was not: ${result.error ?? "it could not be saved."}`
            : result.error ?? "Site access could not be saved.",
        );
        router.refresh();
        return;
      }
    }
    startTransition(() => {
      router.refresh();
      setEditing(false);
    });
    toast.flash(changeCount === 1 ? "1 change saved" : `${changeCount} changes saved`);
  }

  // ── Display lookups ───────────────────────────────────────────────
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? "";
  const deptName = (id: string) =>
    departments.find((d) => d.id === id)?.name ?? (id === employee.departmentId ? employee.department.name : "");
  const supervisorName = (id: string) =>
    id
      ? employees.find((e) => e.id === id)?.user.name ??
        (id === employee.supervisorId ? employee.supervisor?.user.name ?? "" : "")
      : "";
  const roleName = (id: string) => customRoles.find((r) => r.id === id)?.name ?? SYSTEM_ROLE_NAME[employee.role] ?? "";
  const filteredDepts = departments.filter((d) => d.sites.some((ds) => ds.site.id === v.siteId));
  const tone = v.status === "inactive" ? "inactive" : v.status === "on-leave" ? "leave" : "active";
  const statusWord = v.status === "inactive" ? "Inactive" : v.status === "on-leave" ? "On leave" : "Active";

  const payRateText = v.payRate
    ? `$${Number(v.payRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${
        v.payType === "SALARY" ? "per year" : "per hour"
      }`
    : "";

  const cityLine = [v.city, [v.state, v.zipCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const addressText = [v.address1, v.address2, cityLine, v.country].filter(Boolean).join("\n");

  const barcodeHint =
    (employee.barcodeOverride
      ? "Set by hand, so the Oracle sync will not overwrite it."
      : employee.barcodeSyncedAt
        ? `Synced from Oracle ${format(employee.barcodeSyncedAt, "MMM d, h:mm a")}.`
        : "Not synced yet. Only needed when the badge encodes a different number than the Badge ID.") +
    " Kiosks accept either value.";

  // ── Change history ────────────────────────────────────────────────
  const allLogFieldNames = [...new Set(logs.flatMap((e) => e.fields.map((f) => f.field)))].sort();
  const logCutoff = logDays > 0 ? new Date(Date.now() - logDays * 24 * 60 * 60 * 1000) : null;
  const filteredLogs = logs
    .filter((e) => !logCutoff || new Date(e.createdAt) >= logCutoff)
    .map((e) => ({ ...e, fields: logField ? e.fields.filter((f) => f.field === logField) : e.fields }))
    .filter((e) => e.fields.length > 0);

  const text = (key: Key, extra?: Partial<React.ComponentProps<typeof Input>>) => (
    <Input
      id={`f-${key}`}
      name={key}
      value={draft[key] as string}
      onChange={(e) => set(key, e.target.value as never)}
      {...extra}
    />
  );

  const pick = (key: Key, options: ReactNode) => (
    <Select
      id={`f-${key}`}
      name={key}
      value={draft[key] as string}
      onChange={(e) => set(key, e.target.value as never)}
      style={{ width: "100%" }}
    >
      {options}
    </Select>
  );

  /**
   * A saved value the pick list no longer offers (a retired shift, a role or
   * pay code switched off) stays as an option, so the select shows it rather
   * than falling back to the first choice, which a save would then write.
   */
  const keep = (key: Key, offered: { id: string }[], label: string) => {
    const val = saved[key] as string;
    return val && !offered.some((o) => o.id === val) ? <option value={val}>{label}</option> : null;
  };

  const lastChange = logs[0];

  return (
    <>
      <Editing.Provider value={editing}>
      <form id="employee-record" onSubmit={save} className="flex flex-col gap-4">
        <PinnedBar barRef={barRef}>
          <PageHeader
            title={v.name || employee.user.name}
            subtitle={
              editing
                ? changeCount === 0
                  ? "Editing. Nothing changed yet."
                  : `Editing. ${changeCount === 1 ? "1 unsaved change" : `${changeCount} unsaved changes`}.`
                : [v.jobTitle || roleName(v.customRoleId), employee.department.name, employee.site.name]
                    .filter(Boolean)
                    .join(" · ")
            }
            actions={
              editing ? (
                <>
                  <Button type="button" hierarchy="secondary" onClick={cancel} disabled={isPending}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isPending || changeCount === 0}>
                    {isPending ? "Saving…" : "Save changes"}
                  </Button>
                </>
              ) : (
                <>
                  <LinkButton
                    href="/admin/employees"
                    hierarchy="tertiary"
                    leadingIcon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
                  >
                    Employees
                  </LinkButton>
                  <LinkButton
                    href={`/admin/accruals/${employee.id}`}
                    hierarchy="secondary"
                    leadingIcon={<Wallet className="h-4 w-4" aria-hidden="true" />}
                  >
                    View Accruals
                  </LinkButton>
                  <Button
                    type="button"
                    onClick={startEditing}
                    leadingIcon={<Pencil className="h-4 w-4" aria-hidden="true" />}
                  >
                    Edit
                  </Button>
                </>
              )
            }
          />
        </PinnedBar>

        <div className={styles.layout}>
          {/* ── Profile rail ───────────────────────────────────────────── */}
          <aside className={styles.rail} style={railPin ?? undefined}>
            <div className={styles.card}>
              <div className={styles.profile}>
                {/* The tablet's photo over the initials: a person with no
                    photo, or one that fails to load, shows the initials. */}
                <span className={styles.portrait}>
                  <span className={styles.portraitInitials} aria-hidden="true">
                    {initialsOf(v.name || employee.user.name)}
                  </span>
                  <ZoomableFace
                    src={photo}
                    personId={employee.id}
                    name={employee.user.name ?? employee.employeeCode}
                    onZoom={setZoomed}
                  />
                </span>
                {/* In edit mode, for viewers allowed to, the photo can be
                    replaced. It is its own save, like on Live Attendance:
                    Save photo in the editor files it at once, and Cancel on
                    the record does not undo it. */}
                {editing && canEditPhoto && (
                  <div className={styles.photoEdit}>
                    <Button
                      type="button"
                      hierarchy="secondary"
                      size="sm"
                      leadingIcon={<Camera className="h-3.5 w-3.5" aria-hidden="true" />}
                      onClick={() => setEditingPhoto(true)}
                    >
                      {photo ? "Change photo" : "Add photo"}
                    </Button>
                    <span className={styles.photoHint}>Saved on its own, from the photo window</span>
                  </div>
                )}
                {/* The name, title, department and site are in the page
                    header right beside this card, so the card does not
                    repeat them. It carries the face and the status. */}
                <span className={styles.status} data-tone={tone}>
                  <span className={styles.dot} aria-hidden="true" />
                  {statusWord}
                </span>
              </div>
              {/* Assigned once or worked out from other fields, so these stay
                  as text in edit mode too. */}
              <dl className={styles.facts}>
                <div className={styles.fact}>
                  <dt>Employee code</dt>
                  <dd className={styles.mono}>{employee.employeeCode}</dd>
                </div>
                <div className={styles.fact}>
                  <dt>Hire date</dt>
                  <dd>{format(employee.hireDate, "MMM d, yyyy")}</dd>
                </div>
                {/* The date leave tiers are actually measured from: the override
                    when one is set, the hire date otherwise. */}
                <div className={styles.fact}>
                  <dt>Seniority date</dt>
                  <dd>
                    {format(employee.adjustedHireDate ?? employee.hireDate, "MMM d, yyyy")}
                    {employee.adjustedHireDate && <span className={styles.factNote}>Adjusted</span>}
                  </dd>
                </div>
                <div className={styles.fact}>
                  <dt>Last change</dt>
                  <dd>
                    {lastChange ? (
                      <>
                        {format(new Date(lastChange.createdAt), "MMM d, yyyy")}
                        <span className={styles.factNote}>by {lastChange.actorName}</span>
                      </>
                    ) : (
                      <span style={{ color: "var(--text-tertiary)", fontWeight: "normal" }}>No changes yet</span>
                    )}
                  </dd>
                </div>
              </dl>
              <div className={styles.railActions}>
                <Button
                  type="button"
                  hierarchy="secondary"
                  leadingIcon={<KeyRound className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => {
                    setShowPasswordModal(true);
                    setTempStatus("idle");
                    setTempMessage("");
                    setTempPasswordValue("");
                  }}
                >
                  Set Temporary Password
                </Button>
              </div>
            </div>
          </aside>

          <div className={styles.main}>
            {error && <Banner tone="error" body={error} />}

            {/* ── Employment ─────────────────────────────────────────────── */}
            <Section
              icon={Briefcase}
              title="Employment"
              subtitle="Site, department and supervisor decide whose queue this person's timesheets land in"
            >
              <div className={styles.grid}>
                <Field label="Full name" htmlFor="f-name" read={v.name} required>
                  {text("name", { required: true })}
                </Field>
                <Field label="Email (Google login)" htmlFor="f-email" read={v.email}>
                  {text("email", { type: "email" })}
                </Field>
                <Field label="Job title" htmlFor="f-jobTitle" read={v.jobTitle}>
                  {text("jobTitle")}
                </Field>

                <Field label="Role" htmlFor="f-customRoleId" read={roleName(v.customRoleId)}>
                  {pick(
                    "customRoleId",
                    <>
                      {keep("customRoleId", customRoles, `${roleName(saved.customRoleId)} (no longer offered)`)}
                      {customRoles.filter((r) => r.isSystem).map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                      {customRoles.some((r) => !r.isSystem) && (
                        <optgroup label="Custom roles">
                          {customRoles.filter((r) => !r.isSystem).map((r) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </optgroup>
                      )}
                    </>,
                  )}
                </Field>
                <Field label="Site" htmlFor="f-siteId" read={siteName(v.siteId) || employee.site.name}>
                  {pick("siteId", sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>))}
                </Field>
                <Field label="Department" htmlFor="f-departmentId" read={deptName(v.departmentId)}>
                  {pick(
                    "departmentId",
                    <>
                      {filteredDepts.length === 0 && !v.departmentId && <option value="">No departments at this site</option>}
                      {/* A record can sit in a department that is not linked to
                          its site. It stays listed, so the field shows the real
                          value instead of whichever option comes first. */}
                      {v.departmentId && !filteredDepts.some((d) => d.id === v.departmentId) && (
                        <option value={v.departmentId}>{deptName(v.departmentId)} (not linked to this site)</option>
                      )}
                      {filteredDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </>,
                  )}
                </Field>

                <Field label="Supervisor" htmlFor="f-supervisorId" read={supervisorName(v.supervisorId) || "None"}>
                  {pick(
                    "supervisorId",
                    <>
                      <option value="">None</option>
                      {/* The pick list is active people only. A saved
                          supervisor who has left stays listed, so the field
                          shows who it really is instead of falling back to
                          None (which the old form then saved). */}
                      {employee.supervisorId &&
                        employee.supervisor &&
                        !employees.some((e) => e.id === employee.supervisorId) && (
                          <option value={employee.supervisorId}>
                            {employee.supervisor.user.name}
                            {employee.supervisor.isActive ? "" : " (inactive)"}
                          </option>
                        )}
                      {employees
                        .filter((e) => e.id !== employee.id)
                        .map((e) => <option key={e.id} value={e.id}>{e.user.name}</option>)}
                    </>,
                  )}
                </Field>
                {/* Read mode shows status once, on the profile card. The
                    field only appears here when it can be changed. */}
                {editing && (
                  <Field label="Status" htmlFor="f-status" read={null}>
                    {pick(
                      "status",
                      <>
                        <option value="active">Active</option>
                        <option value="on-leave">On leave</option>
                        <option value="inactive">Inactive</option>
                      </>,
                    )}
                  </Field>
                )}
                {v.status === "inactive" ? (
                  <Field label="Termination reason" htmlFor="f-terminationReason" read={v.terminationReason}>
                    {text("terminationReason")}
                  </Field>
                ) : null}

                <Field
                  label="Adjusted hire date"
                  htmlFor="f-adjustedHireDate"
                  read={v.adjustedHireDate ? format(new Date(`${v.adjustedHireDate}T12:00:00`), "MMM d, yyyy") : ""}
                  hint="Overrides the hire date for leave tiers, when the leave policy counts service from the adjusted hire date."
                  readHint={v.adjustedHireDate ? undefined : "Leave tiers count from the hire date."}
                >
                  {text("adjustedHireDate", { type: "date" })}
                </Field>
              </div>
            </Section>

            {/* ── Pay & rules ────────────────────────────────────────────── */}
            <Section
              icon={CircleDollarSign}
              title="Pay & Rules"
              subtitle="The rule set calculates the hours. The pay method decides whether punches affect pay at all."
            >
              <div className={styles.grid}>
                <Field label="Rule set" htmlFor="f-ruleSetId" read={ruleSets.find((r) => r.id === v.ruleSetId)?.name ?? employee.ruleSet.name}>
                  {pick(
                    "ruleSetId",
                    <>
                      {keep("ruleSetId", ruleSets, `${employee.ruleSet.name} (no longer offered)`)}
                      {ruleSets.map((rs) => <option key={rs.id} value={rs.id}>{rs.name}</option>)}
                    </>,
                  )}
                </Field>
                <Field
                  label="Shift"
                  htmlFor="f-shiftId"
                  read={(() => {
                    const sh = shifts.find((x) => x.id === v.shiftId);
                    if (!sh) return v.shiftId ? "Retired shift" : "None";
                    return (
                      <span className="flex flex-col gap-0.5">
                        <span>{sh.name}</span>
                        <span className={styles.subValue}>
                          {fmtTime(sh.startTime)} to {fmtTime(sh.endTime)}
                        </span>
                      </span>
                    );
                  })()}
                >
                  {pick(
                    "shiftId",
                    <>
                      <option value="">None</option>
                      {keep("shiftId", shifts, "Retired shift")}
                      {shifts.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({fmtTime(s.startTime)} to {fmtTime(s.endTime)})
                        </option>
                      ))}
                    </>,
                  )}
                </Field>
                <Field label="Holiday rule" htmlFor="f-holidayRuleId" read={holidayRules.find((r) => r.id === v.holidayRuleId)?.name ?? (v.holidayRuleId ? "Retired holiday rule" : "None")}>
                  {pick(
                    "holidayRuleId",
                    <>
                      <option value="">None</option>
                      {keep("holidayRuleId", holidayRules, "Retired holiday rule")}
                      {holidayRules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </>,
                  )}
                </Field>

                <Field
                  label="Pay category"
                  htmlFor="f-payCategoryId"
                  read={(() => {
                    const c = payCategories.find((x) => x.id === v.payCategoryId);
                    return c ? <Coded item={c} /> : v.payCategoryId ? "Retired pay category" : "None";
                  })()}
                >
                  {pick(
                    "payCategoryId",
                    <>
                      <option value="">None</option>
                      {keep("payCategoryId", payCategories, "Retired pay category")}
                      {payCategories.map((c) => <option key={c.id} value={c.id}>{numbered(c)}</option>)}
                    </>,
                  )}
                </Field>
                <Field
                  label="Pay type"
                  htmlFor="f-payTypeId"
                  read={(() => {
                    const t = payTypes.find((x) => x.id === v.payTypeId);
                    return t ? <Coded item={t} /> : v.payTypeId ? "Retired pay type" : "None";
                  })()}
                >
                  {pick(
                    "payTypeId",
                    <>
                      <option value="">None</option>
                      {keep("payTypeId", payTypes, "Retired pay type")}
                      {payTypes.map((pt) => <option key={pt.id} value={pt.id}>{numbered(pt)}</option>)}
                    </>,
                  )}
                </Field>
                <Field label="Pay method" htmlFor="f-payType" read={v.payType === "SALARY" ? "Salary" : "Hourly"}>
                  {pick(
                    "payType",
                    <>
                      <option value="HOURLY">Hourly</option>
                      <option value="SALARY">Salary</option>
                    </>,
                  )}
                </Field>

                <Field
                  label={v.payType === "SALARY" ? "Pay rate (per year)" : "Pay rate (per hour)"}
                  htmlFor="f-payRate"
                  read={
                    v.payRate ? (
                      <span className={styles.amount}>
                        {payRateText.split(" per ")[0]}
                        <span className={styles.amountUnit}> per {payRateText.split(" per ")[1]}</span>
                      </span>
                    ) : (
                      ""
                    )
                  }
                >
                  {text("payRate", { type: "number", min: "0.01", step: "0.01", placeholder: "0.00", leadingIcon: <span style={{ color: "var(--text-tertiary)" }}>$</span> })}
                </Field>
              </div>
            </Section>

            {/* ── Badges & IDs ───────────────────────────────────────────── */}
            <Section icon={ScanLine} title="Badges & IDs" subtitle="What the kiosks, the WMS and ADP know this person by">
              <div className={styles.grid}>
                <Field label="Badge ID (WMS)" htmlFor="f-wmsId" read={v.wmsId} mono>
                  {text("wmsId", { placeholder: "QR code badge ID" })}
                </Field>
                <Field
                  label="Badge barcode"
                  htmlFor="f-barcode"
                  read={v.barcode}
                  mono
                  hint={barcodeHint}
                  readHint={barcodeHint}
                >
                  {text("barcode", { placeholder: "10 digit code on the badge" })}
                </Field>
                <Field label="ADP Worker ID" htmlFor="f-adpWorkerId" read={v.adpWorkerId} mono>
                  {text("adpWorkerId", { placeholder: "ADP Workforce Now ID" })}
                </Field>
              </div>
            </Section>

            {/* ── Personal & contact ─────────────────────────────────────── */}
            <Section icon={ContactRound} title="Personal & Contact" subtitle="Held encrypted and only read back on this screen">
              <div className={styles.grid}>
                <Field label="Phone 1" htmlFor="f-phone" read={v.phone}>
                  {text("phone", { type: "tel" })}
                </Field>
                <Field label="Phone 2" htmlFor="f-phone2" read={v.phone2}>
                  {text("phone2", { type: "tel" })}
                </Field>
                <Field label="Gender" htmlFor="f-gender" read={v.gender}>
                  {text("gender")}
                </Field>
                <Field label="Marital status" htmlFor="f-maritalStatus" read={v.maritalStatus}>
                  {pick(
                    "maritalStatus",
                    <>
                      <option value="">Not set</option>
                      {MARITAL.map((m) => <option key={m} value={m}>{m}</option>)}
                      {v.maritalStatus && !MARITAL.includes(v.maritalStatus) && (
                        <option value={v.maritalStatus}>{v.maritalStatus}</option>
                      )}
                    </>,
                  )}
                </Field>
              </div>

              <div className={styles.group}>
                <h3 className={styles.groupTitle}>Emergency contact</h3>
                <div className={styles.grid}>
                  <Field label="Name" htmlFor="f-emergencyContact" read={v.emergencyContact}>
                    {text("emergencyContact")}
                  </Field>
                  <Field label="Phone" htmlFor="f-emergencyPhone" read={v.emergencyPhone}>
                    {text("emergencyPhone", { type: "tel" })}
                  </Field>
                  <Field label="Relationship" htmlFor="f-emergencyRelationship" read={v.emergencyRelationship}>
                    {text("emergencyRelationship", { placeholder: "Spouse, parent, friend" })}
                  </Field>
                </div>
              </div>

              <div className={styles.group}>
                <h3 className={styles.groupTitle}>Address</h3>
                {editing ? (
                  <div className={`${styles.grid} ${styles.editing}`}>
                    <Field label="Address line 1" htmlFor="f-address1" read="">
                      {text("address1")}
                    </Field>
                    <Field label="Address line 2" htmlFor="f-address2" read="">
                      {text("address2")}
                    </Field>
                    <Field label="City" htmlFor="f-city" read="">
                      {text("city")}
                    </Field>
                    <Field label="State or province" htmlFor="f-state" read="">
                      {text("state")}
                    </Field>
                    <Field label="Zip code" htmlFor="f-zipCode" read="">
                      {text("zipCode")}
                    </Field>
                    <Field label="Country" htmlFor="f-country" read="">
                      {text("country")}
                    </Field>
                  </div>
                ) : (
                  // Read as an address, not as seven boxes.
                  <div className={styles.grid}>
                    <Field label="Mailing address" read={addressText}>
                      {null}
                    </Field>
                  </div>
                )}
              </div>
            </Section>

            {/* ── Site access ────────────────────────────────────────────── */}
            {showsSiteAccess && (
              <Section
                icon={Building2}
                title="Site Access"
                subtitle={
                  limitedToLiveAttendance
                    ? "Which buildings this account can see on Live Attendance"
                    : "Which sites this HR user can see employees from"
                }
              >
                {editing && canManageSiteAccess ? (
                  <div className={styles.accessEdit}>
                    <p className={styles.hint} style={{ margin: 0, font: "var(--type-body2)" }}>
                      {limitedToLiveAttendance
                        ? draftAccess.size === 0
                          ? "No buildings checked, so this account sees every building on Live Attendance."
                          : "Only the checked buildings show on Live Attendance. Uncheck them all to show every building."
                        : draftAccess.size === 0
                          ? "No sites checked, so this user sees employees at every site."
                          : "Only the checked sites are visible to this user. Uncheck them all to grant every site."}
                    </p>
                    <div className={styles.checks}>
                      {sites.map((s) => (
                        <div key={s.id} className="flex items-center py-1.5">
                          <Checkbox
                            id={`site-access-${s.id}`}
                            label={s.name}
                            checked={draftAccess.has(s.id)}
                            onChange={(next) => {
                              const updated = new Set(draftAccess);
                              if (next) updated.add(s.id);
                              else updated.delete(s.id);
                              setDraftAccess(updated);
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className={styles.grid}>
                    <Field
                      label="Visible sites"
                      read={
                        access.size === 0 ? (
                          "Every site"
                        ) : (
                          <span className={styles.chips}>
                            {sites
                              .filter((s) => access.has(s.id))
                              .map((s) => <span key={s.id} className={styles.chip}>{s.name}</span>)}
                          </span>
                        )
                      }
                    >
                      {null}
                    </Field>
                  </div>
                )}
                {editing && !canManageSiteAccess && (
                  <p className={styles.hint} style={{ margin: 0 }}>
                    Only HR Admin or System Admin users can edit site access.
                  </p>
                )}
              </Section>
            )}

            {/* ── Change history ─────────────────────────────────────────── */}
            <section className={styles.card} aria-label="Change History">
              <header className={styles.sectionHead}>
                <span className={styles.sectionIcon} aria-hidden="true">
                  <History className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h2 className={styles.sectionTitle}>Change History</h2>
                  <p className={styles.sectionSub}>Every field this record has had edited, newest first</p>
                </div>
              </header>
              {logs.length > 0 && (
                <div className={styles.historyBar}>
                  <Select aria-label="Field" value={logField} onChange={(e) => setLogField(e.target.value)}>
                    <option value="">All fields</option>
                    {allLogFieldNames.map((name) => <option key={name} value={name}>{name}</option>)}
                  </Select>
                  {/* Local, not a URL parameter: the whole history is already on
                      the client and nobody links to "this record, last 7 days". */}
                  <SegmentedControl
                    ariaLabel="Date range"
                    size="sm"
                    items={[
                      { value: "0", label: "All time" },
                      { value: "30", label: "30 days" },
                      { value: "7", label: "7 days" },
                    ]}
                    value={String(logDays)}
                    onChange={(val) => setLogDays(Number(val))}
                  />
                  <span className="tabular ml-auto" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                    {filteredLogs.length} {filteredLogs.length === 1 ? "change" : "changes"}
                  </span>
                </div>
              )}
              {filteredLogs.length === 0 ? (
                <EmptyState
                  icon={<History className="h-8 w-8" />}
                  title={logs.length === 0 ? "No changes recorded yet" : "No changes in this range"}
                  body={
                    logs.length === 0
                      ? "Edits made from this screen are written to the audit log and will appear here."
                      : "Widen the date range, or switch back to all fields."
                  }
                />
              ) : (
                <ul className={styles.historyList}>
                  {/* One entry per save, not per field: the fields that moved
                      together moved for one reason. */}
                  {filteredLogs.map((entry) => (
                    <li key={entry.id} className={styles.entry}>
                      <div className={styles.entryWhen}>
                        <span>{format(new Date(entry.createdAt), "MMM d, yyyy h:mm a")}</span>
                        <span className={styles.entryWho}>{entry.actorName}</span>
                      </div>
                      <div className={styles.changes}>
                        {entry.fields.map((f, i) => (
                          <div key={i} className={styles.change}>
                            <span className={styles.changeField}>{f.field}</span>
                            <span className={styles.changeValues}>
                              <span className={styles.before}>{shown(f.before)}</span>
                              <ArrowRight className={styles.arrow} aria-label="changed to" />
                              <span>{shown(f.after)}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </form>
      </Editing.Provider>

      <Toast message={toast.message} />

      {editingPhoto && (
        <PhotoEditor
          siteId={employee.siteId}
          employeeId={employee.id}
          name={employee.user.name ?? employee.employeeCode}
          detail={[employee.employeeCode, employee.jobTitle ?? employee.department.name].filter(Boolean).join(" · ")}
          currentSrc={photo}
          onClose={() => setEditingPhoto(false)}
          onSaved={(url) => {
            setEditingPhoto(false);
            setPhotoSaved({ url });
            toast.flash("Photo saved");
            // The sidebar shows the signed-in person's own photo from the
            // layout, so a refresh keeps it in step when that is who this is.
            router.refresh();
          }}
        />
      )}

      {zoomed && (
        <PhotoViewer
          src={zoomed}
          name={employee.user.name ?? employee.employeeCode}
          detail={`${employee.employeeCode} · ${employee.department.name} · ${employee.site.name}`}
          onClose={() => setZoomed(null)}
        />
      )}

      {/* ── Temp password modal ───────────────────────────────────────────── */}
      {showPasswordModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowPasswordModal(false); }}
        >
          <div className="ta-modal w-full max-w-sm rounded-xl p-6">
            <h2 style={{ margin: 0, font: "var(--type-h3)", color: "var(--text-primary)" }}>
              Set Temporary Password
            </h2>
            <p className="mt-1" style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-secondary)" }}>
              The employee will be required to change this on first login.
            </p>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setTempStatus("loading");
                setTempMessage("");
                const result = await setTemporaryPassword(employee.id, tempPassword);
                setTempStatus(result.success ? "done" : "error");
                setTempMessage(result.message);
                if (result.success) setTempPasswordValue("");
              }}
              className="mt-4 flex flex-col gap-3"
            >
              {/* Shown as text, not dots: whoever sets this has to read it back
                  to the employee, and a masked field they cannot check is how a
                  typo becomes a locked-out badge on a Monday morning. */}
              <Input
                label="Temporary password"
                type="text"
                value={tempPassword}
                onChange={(e) => setTempPasswordValue(e.target.value)}
                placeholder="Enter temporary password"
                minLength={8}
                required
                hint="8+ characters, with an uppercase letter, a number and a special character."
              />

              {tempMessage && (
                <Banner tone={tempStatus === "error" ? "error" : "success"} body={tempMessage} />
              )}

              <div className="mt-1 flex justify-end gap-2">
                <Button type="button" hierarchy="secondary" onClick={() => setShowPasswordModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={tempStatus === "loading"}>
                  {tempStatus === "loading" ? "Saving…" : "Set Password"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
