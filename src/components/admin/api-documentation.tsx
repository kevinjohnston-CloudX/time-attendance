"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Braces, Check, ChevronDown, Copy, Lock } from "lucide-react";

/**
 * The external API reference, from the Integrations handoff: an "On this
 * page" list beside one panel of three sections that open and close.
 *
 * <p>Written against the two routes under /api/external, not against the
 * old copy of this page. The leave request route submits what it creates, so
 * a request sent here lands PENDING (the old text said DRAFT), and the leave
 * types route returns externalCode, which is what goes in leaveTypeCode (the
 * old text said "code", a field nothing returns).
 *
 * <p>The base URL is whichever address the page was opened on, passed from
 * the server so the examples a vendor copies point at the right place.
 */

export type DocSection = "auth" | "lt" | "pto";

const MONO = "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)";
const PANEL: CSSProperties = { background: "var(--surface-card)", borderRadius: 18, boxShadow: "var(--ta-shell-shadow)" };
const EYEBROW: CSSProperties = {
  font: "var(--weight-semibold) 11px/14px var(--font-sans)",
  letterSpacing: ".07em",
  textTransform: "uppercase",
  color: "var(--text-tertiary)",
};

/** Copy with a check for a moment afterwards. `dark` is the one on a code block. */
export function CopyButton({ text, label = "Copy", dark = false, iconOnly = false }: { text: string; label?: string; dark?: boolean; iconOnly?: boolean }) {
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
  const icon = done ? <Check className="h-[15px] w-[15px]" /> : <Copy className="h-[15px] w-[15px]" />;
  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={copy}
        aria-label={done ? "Copied" : label}
        title={done ? "Copied" : label}
        className="ta-icon-btn h-7 w-7"
        style={{ borderRadius: 8, color: done ? "var(--icon-success)" : undefined }}
      >
        {icon}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap px-2"
      style={{
        border: 0,
        borderRadius: 7,
        background: "transparent",
        cursor: "pointer",
        font: "var(--weight-medium) 11px/1 var(--font-sans)",
        color: done ? "var(--wms-color-emerald-400)" : dark ? "var(--ta-code-muted)" : "var(--text-secondary)",
      }}
    >
      {icon}
      {done ? "Copied" : label}
    </button>
  );
}

function CodeBlock({ code, lang = "json" }: { code: string; lang?: string }) {
  return (
    <div className="overflow-hidden" style={{ borderRadius: 12, background: "var(--ta-code-bg)" }}>
      <div className="flex h-[34px] items-center justify-between pl-3.5 pr-2" style={{ boxShadow: "inset 0 -1px 0 var(--ta-code-rule)" }}>
        <span style={{ font: "var(--weight-medium) 11px/1 var(--font-sans)", letterSpacing: ".04em", color: "var(--ta-code-muted)" }}>{lang}</span>
        <CopyButton text={code} dark />
      </div>
      <pre
        className="ta-scroll m-0 overflow-x-auto px-3.5 pb-3.5 pt-3"
        style={{ whiteSpace: "pre", fontFamily: MONO, fontSize: 12, lineHeight: 1.7, color: "var(--ta-code-fg)" }}
      >
        {code}
      </pre>
    </div>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code style={{ fontFamily: MONO, fontSize: 12, padding: "1px 5px", borderRadius: 5, background: "var(--ta-well)", color: "var(--text-primary)" }}>
      {children}
    </code>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <div style={{ ...EYEBROW, marginTop: 18, marginBottom: 8 }}>{children}</div>;
}

function Method({ method, wide = false }: { method: "GET" | "POST"; wide?: boolean }) {
  return (
    <span
      className="grid flex-none place-items-center"
      style={{
        width: wide ? 44 : 40,
        height: wide ? 22 : 20,
        borderRadius: 6,
        fontFamily: MONO,
        fontSize: wide ? 11 : 10,
        fontWeight: 700,
        background: method === "GET" ? "var(--surface-success)" : "var(--surface-info)",
        color: method === "GET" ? "var(--text-success)" : "var(--text-accent)",
      }}
    >
      {method}
    </span>
  );
}
export { Method as MethodBadge };

function Fields({ rows }: { rows: { name: string; type?: string; required?: boolean; text: string }[] }) {
  return (
    <div className="overflow-hidden" style={{ borderRadius: 12, boxShadow: "inset 0 0 0 1px var(--ta-well-ring)" }}>
      {rows.map((r, i) => (
        <div
          key={r.name}
          className="grid items-baseline gap-x-3 gap-y-1 px-3.5 py-2.5 [grid-template-columns:minmax(0,1fr)] sm:[grid-template-columns:170px_90px_minmax(0,1fr)]"
          style={{ boxShadow: i < rows.length - 1 ? "inset 0 -1px 0 var(--ta-well)" : undefined }}
        >
          <span className="flex items-baseline gap-2">
            <code style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{r.name}</code>
            {r.required && (
              <span style={{ font: "var(--weight-semibold) 10px/1 var(--font-sans)", letterSpacing: ".04em", textTransform: "uppercase", color: "var(--text-error)" }}>
                required
              </span>
            )}
          </span>
          <span style={{ fontFamily: MONO, fontSize: 12, color: "var(--text-tertiary)" }}>{r.type}</span>
          <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>{r.text}</span>
        </div>
      ))}
    </div>
  );
}

function Section({
  id,
  open,
  onToggle,
  badge,
  title,
  path,
  offset,
  children,
}: {
  id: DocSection;
  /** How far below the top a jump to this section stops: under the pinned bar. */
  offset: number;
  open: boolean;
  onToggle: () => void;
  badge: ReactNode;
  title: string;
  path?: string;
  children: ReactNode;
}) {
  return (
    <div id={`doc-${id}`} style={{ scrollMarginTop: offset + 8, borderRadius: 14, boxShadow: "inset 0 0 0 1px var(--ta-well-ring)" }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="ta-hoverable flex w-full items-center gap-3 py-3.5 pl-[18px] pr-4 text-left"
        style={{ border: 0, background: "transparent", borderRadius: 14, cursor: "pointer" }}
      >
        {badge}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span style={{ font: "var(--weight-semibold) 14px/20px var(--font-sans)", color: "var(--text-primary)" }}>{title}</span>
          {path && <code className="truncate" style={{ fontFamily: MONO, fontSize: 12, color: "var(--text-secondary)" }}>{path}</code>}
        </span>
        <ChevronDown
          className="h-4 w-4 flex-none"
          aria-hidden
          style={{ color: "var(--icon-secondary)", transform: open ? "rotate(180deg)" : "none", transition: "transform 150ms ease" }}
        />
      </button>
      {open && <div className="px-[18px] pb-[18px] pt-1 sm:pl-[74px]">{children}</div>}
    </div>
  );
}

const TOC: { id: DocSection; method: "" | "GET" | "POST"; label: string }[] = [
  { id: "auth", method: "", label: "Authentication" },
  { id: "lt", method: "GET", label: "List Leave Types" },
  { id: "pto", method: "POST", label: "Submit a Leave Request" },
];

export function ApiDocumentation({ baseUrl, initialOpen, stickyTop }: { baseUrl: string; initialOpen?: DocSection; stickyTop: number }) {
  const [open, setOpen] = useState<Record<DocSection, boolean>>({ auth: true, lt: initialOpen === "lt", pto: initialOpen === "pto" });
  const toggle = (id: DocSection) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  // Jumps aim below the bar at its full height: a jump near the top of the
  // page makes a slimmed bar grow back, and it would cover the section.
  const [reach, setReach] = useState(stickyTop);
  if (stickyTop > reach) setReach(stickyTop);

  // Arriving from the Connect panel on one endpoint: bring that section up,
  // once the pinned bar has been measured so it does not land under it.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current || !initialOpen || initialOpen === "auth" || stickyTop === 0) return;
    arrived.current = true;
    document.getElementById(`doc-${initialOpen}`)?.scrollIntoView({ block: "start" });
  }, [initialOpen, stickyTop]);

  const go = (id: DocSection) => {
    setOpen((o) => ({ ...o, [id]: true }));
    requestAnimationFrame(() => document.getElementById(`doc-${id}`)?.scrollIntoView({ block: "start" }));
  };

  const auth = "Authorization: Bearer ta_a1b2c3d4e5f6...";
  const ltReq = `GET ${baseUrl}/api/external/leave-types\nAuthorization: Bearer ta_a1b2c3d4...`;
  const ltRes = `{
  "leaveTypes": [
    {
      "externalCode": 1,
      "name": "Paid Time Off",
      "category": "PTO",
      "requiresApproval": true,
      "isPaid": true
    },
    {
      "externalCode": 2,
      "name": "Sick Leave",
      "category": "SICK",
      "requiresApproval": false,
      "isPaid": true
    }
  ]
}`;
  const days = `  "selectedDays": [
    { "date": "2026-09-01", "type": "FULL" },
    { "date": "2026-09-02", "type": "PARTIAL", "minutes": 300 }
  ],
  "note": "Family appointment"
}`;
  const head = `POST ${baseUrl}/api/external/pto-requests\nAuthorization: Bearer ta_a1b2c3d4...\nContent-Type: application/json\n\n{\n`;
  const reqCode = `${head}  "employeeCode": "EMP001",\n  "leaveTypeCode": 1,\n${days}`;
  const reqEmail = `${head}  "email": "john.smith@example.com",\n  "leaveTypeCode": 1,\n${days}`;
  const res201 = `{
  "leaveRequestId": "clx1a2b3c4d5e6f7g8h9",
  "status": "PENDING",
  "durationMinutes": 720
}`;

  const para: CSSProperties = { margin: 0, font: "var(--type-body1)", color: "var(--text-secondary)", textWrap: "pretty" };

  return (
    <div className="flex flex-wrap items-start gap-3.5">
      <nav
        aria-label="On this page"
        className="flex-[1_1_200px] px-2 py-3 lg:sticky lg:max-w-[240px]"
        style={{ ...PANEL, borderRadius: 16, top: stickyTop }}
      >
        <div className="px-2 pb-2 pt-0.5" style={EYEBROW}>
          On this page
        </div>
        {TOC.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => go(t.id)}
            className="ta-hoverable flex h-[34px] w-full items-center gap-2 px-2 text-left"
            style={{
              border: 0,
              borderRadius: 9,
              cursor: "pointer",
              background: open[t.id] ? "var(--ta-well)" : "transparent",
              font: `${open[t.id] ? "var(--weight-semibold)" : "var(--weight-medium)"} 13px/1 var(--font-sans)`,
              color: open[t.id] ? "var(--text-primary)" : "var(--text-secondary)",
            }}
          >
            <span className="w-[34px] flex-none" style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: t.method === "GET" ? "var(--text-success)" : "var(--text-accent)" }}>
              {t.method}
            </span>
            <span className="truncate">{t.label}</span>
          </button>
        ))}
      </nav>

      <section className="min-w-0 flex-[999_1_520px] px-5 pb-5 pt-[18px]" style={PANEL}>
        <div className="mb-3.5 flex items-center gap-3">
          <span
            className="grid h-9 w-9 flex-none place-items-center"
            style={{ borderRadius: 10, background: "var(--ta-well)", boxShadow: "inset 0 0 0 1px var(--ta-well-ring)", color: "var(--icon-tertiary)" }}
          >
            <Braces className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span style={{ font: "var(--weight-semibold) 15px/20px var(--font-sans)", color: "var(--text-primary)" }}>External REST API</span>
            <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
              Authentication, endpoints and example requests for the keys on the API Keys tab
            </span>
          </span>
        </div>

        <div className="flex max-w-[860px] flex-col gap-2">
          <Section
            id="auth"
            offset={reach}
            open={open.auth}
            onToggle={() => toggle("auth")}
            title="Authentication"
            badge={
              <span className="grid h-[22px] w-11 flex-none place-items-center" style={{ borderRadius: 6, background: "var(--ta-well)", color: "var(--icon-secondary)" }}>
                <Lock className="h-[15px] w-[15px]" aria-hidden />
              </span>
            }
          >
            <div className="flex flex-col gap-2.5">
              <p style={para}>
                All requests must include an API key in the <Code>Authorization</Code> header. Generate keys from the{" "}
                <b style={{ fontWeight: 600, color: "var(--text-primary)" }}>API Keys</b> tab.
              </p>
              <CodeBlock lang="http" code={auth} />
              <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                Requests without a valid key receive a <Code>401 Unauthorized</Code> response.
              </p>
            </div>
          </Section>

          <Section
            id="lt"
            offset={reach}
            open={open.lt}
            onToggle={() => toggle("lt")}
            badge={<Method method="GET" wide />}
            title="List Leave Types"
            path="/api/external/leave-types"
          >
            <p style={para}>
              Returns all active leave types for your company. Send a type&apos;s <Code>externalCode</Code> as <Code>leaveTypeCode</Code> when
              you submit a leave request.
            </p>
            <Label>Example Request</Label>
            <CodeBlock lang="http" code={ltReq} />
            <Label>Example Response</Label>
            <CodeBlock code={ltRes} />
          </Section>

          <Section
            id="pto"
            offset={reach}
            open={open.pto}
            onToggle={() => toggle("pto")}
            badge={<Method method="POST" wide />}
            title="Submit a Leave Request"
            path="/api/external/pto-requests"
          >
            <p style={para}>
              Creates a leave request for an employee and submits it straight away. It arrives as{" "}
              <b style={{ fontWeight: 600, color: "var(--text-primary)" }}>PENDING</b> and waits for approval like any other request.
            </p>
            <Label>Request Body</Label>
            <div className="mb-2 px-3 py-2" style={{ borderRadius: 10, background: "var(--surface-warning)", font: "var(--type-body2)", color: "var(--text-warning)" }}>
              Either <Code>employeeCode</Code> or <Code>email</Code> must be provided. You don&apos;t need both.
            </div>
            <Fields
              rows={[
                { name: "employeeCode", type: "string", text: "Employee's code. Use this or email. At least one is required." },
                { name: "email", type: "string", text: "Employee's email address. Use this or employeeCode. At least one is required." },
                { name: "leaveTypeCode", type: "integer", required: true, text: "The leave type's externalCode (from /api/external/leave-types)." },
                { name: "selectedDays", type: "array", required: true, text: "Array of day objects. Each must include a date and type." },
                { name: "note", type: "string", text: "Optional note attached to the request." },
              ]}
            />
            <Label>selectedDays: Full Day</Label>
            <CodeBlock code={`{ "date": "2026-09-01", "type": "FULL" }`} />
            <Label>selectedDays: Partial Day</Label>
            <p style={{ margin: "0 0 8px", font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
              For partial days, provide <Code>minutes</Code> as a positive integer (max 1440). The duration is taken directly from the minutes value.
            </p>
            <CodeBlock code={`{ "date": "2026-09-02", "type": "PARTIAL", "minutes": 300 }`} />
            <Label>Example Request using employeeCode</Label>
            <CodeBlock lang="http" code={reqCode} />
            <Label>Example Request using email</Label>
            <CodeBlock lang="http" code={reqEmail} />
            <Label>Example Response: 201 Created</Label>
            <CodeBlock code={res201} />
            <Label>Error Responses</Label>
            <Fields
              rows={[
                { name: "401", text: "Missing or invalid API key." },
                { name: "400", text: "Validation failed, or the body is not valid JSON. A validation failure includes a details object." },
                { name: "404", text: "Employee or leave type not found." },
              ]}
            />
          </Section>
        </div>
      </section>
    </div>
  );
}
