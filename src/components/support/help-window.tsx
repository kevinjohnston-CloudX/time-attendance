"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Bug,
  CircleCheck,
  CircleCheckBig,
  HelpCircle,
  Italic,
  LifeBuoy,
  Lightbulb,
  List,
  ListOrdered,
  Loader2,
  OctagonAlert,
  Paperclip,
  Send,
  TriangleAlert,
  Underline as UnderlineIcon,
  X,
  type LucideIcon,
} from "lucide-react";
import { Banner, Button, ConfirmDialog, Input, SegmentedControl } from "@/components/ui";
import { locate } from "@/components/layout/nav-model";
import { useBreadcrumbLeafFor } from "@/components/layout/breadcrumb-leaf";
import { getSupportRequestContext, sendSupportRequest } from "@/actions/support.actions";
import { SUPPORT_LIMITS, supportRequestSchema } from "@/lib/validators/support.schema";
import { Face } from "@/components/presence/face";
import styles from "./help-window.module.css";

/**
 * Help & feedback: send CloudTime Support a problem, a question or an idea.
 *
 * <p>The same request as the ticketing system's own Help & feedback window,
 * drawn the CloudTime way (the Export window's frame): a summary, the details
 * with formatting and pasted screenshots, files, what kind of request it is,
 * and how badly it is getting in the way. Critical is only for a system issue,
 * and asks once more before it goes, because it alerts the support team.
 *
 * <p>The people who send these have no login on the ticketing side, so the
 * answer comes by email: the window says which address before anything is
 * sent, and once it is sent, that a confirmation went there and that replying
 * to it is how to follow up.
 */

type RequestType = "system_issue" | "suggestion" | "question";
type Impact = "idea" | "workable" | "blocking";

const TYPES: { value: RequestType; title: string; body: string; icon: LucideIcon }[] = [
  { value: "system_issue", title: "System issue", body: "Error or unexpected behavior", icon: Bug },
  { value: "suggestion", title: "Suggestion", body: "New feature or improvement", icon: Lightbulb },
  { value: "question", title: "Question", body: "Help using CloudTime", icon: HelpCircle },
];

/**
 * Signal bars for an impact level: as many filled as the level is high, the
 * rest a faint outline, coloured by how urgent the level is.
 */
function ImpactBars({ level, color }: { level: 1 | 2 | 3; color: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="flex-none">
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={1 + i * 4}
          y={8 - i * 3}
          width="2.5"
          height={3 + i * 3}
          rx="0.75"
          fill={i < level ? color : "var(--icon-disabled)"}
          opacity={i < level ? 1 : 0.45}
        />
      ))}
    </svg>
  );
}

const impactLabel = (text: string, level: 1 | 2 | 3, color: string) => (
  <span className="inline-flex items-center gap-1 whitespace-nowrap">
    <ImpactBars level={level} color={color} />
    {text}
  </span>
);

const IMPACT_ITEMS = [
  { value: "idea", label: impactLabel("Low", 1, "var(--icon-accent)") },
  { value: "workable", label: impactLabel("Moderate", 2, "var(--icon-warning)") },
  { value: "blocking", label: impactLabel("Critical", 3, "var(--icon-error)") },
];

const IMPACT_NOTE: Record<Impact, string> = {
  idea: "No effect on daily work.",
  workable: "Work continues with a workaround.",
  blocking: "Work is stopped. Support is notified immediately.",
};

type Attached = { key: string; file: File };
type FieldError = { field: "subject" | "details"; message: string };
type Context = { email: string | null; name: string | null; company: string | null; available: boolean };
type Sent = { ticketNumber: string; confirmationTo: string; confirmationSent: boolean };

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]):not([type="file"]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

/** The send shortcut as this computer writes it. */
const SEND_KEYS =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘ Enter" : "Ctrl Enter";

const formatBytes =(n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

const initials = (name: string | null, email: string | null) =>
  ((name ?? email ?? "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("") || "?");

export function HelpWindow({ onClose, photo = null }: { onClose: () => void; photo?: string | null }) {
  const pathname = usePathname();
  const here = locate(pathname);
  const leaf = useBreadcrumbLeafFor(pathname);
  const pageName = here?.item?.label ?? here?.section.label ?? null;
  const pageLabel = pageName && leaf && leaf !== pageName ? `${pageName}: ${leaf}` : pageName;

  const [context, setContext] = useState<Context | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [type, setType] = useState<RequestType>("question");
  const [impact, setImpact] = useState<Impact>("idea");
  const [subject, setSubject] = useState("");
  const [files, setFiles] = useState<Attached[]>([]);
  const [bodySize, setBodySize] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<FieldError | null>(null);
  const [checkingCritical, setCheckingCritical] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const [sending, setSending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [editorKey, setEditorKey] = useState(0);

  useEffect(() => {
    let live = true;
    getSupportRequestContext().then((res) => {
      if (!live) return;
      if (res.success) setContext(res.data);
      else setContextError(res.error);
    });
    return () => {
      live = false;
    };
  }, []);

  // Critical belongs to a system issue only; switching away folds it down.
  function pickType(next: RequestType) {
    setType(next);
    if (next !== "system_issue" && impact === "blocking") setImpact("workable");
  }

  const filesSize = files.reduce((n, f) => n + f.file.size, 0);
  // The editor is made once, so it reads the file total through a ref.
  const filesSizeRef = useRef(0);
  useEffect(() => {
    filesSizeRef.current = filesSize;
  }, [filesSize]);
  const overBudget = filesSize + bodySize > SUPPORT_LIMITS.totalBytes;

  const addFiles = useCallback((list: FileList | File[]) => {
    const incoming = Array.from(list).filter((f) => f.size > 0);
    if (incoming.length === 0) return;
    setFiles((prev) => {
      const room = SUPPORT_LIMITS.files - prev.length;
      if (incoming.length > room) setFailure(`Attach at most ${SUPPORT_LIMITS.files} files.`);
      return [...prev, ...incoming.slice(0, Math.max(0, room)).map((file) => ({ key: `${file.name}-${file.size}-${Math.random()}`, file }))];
    });
  }, []);

  const dirty = () => !!subject.trim() || bodySize > 0 || files.length > 0;
  const requestClose = () => {
    if (sending) return;
    if (!sent && dirty()) setConfirmDiscard(true);
    else onClose();
  };

  function reset() {
    setType("question");
    setImpact("idea");
    setSubject("");
    setFiles([]);
    setBodySize(0);
    setFailure(null);
    setFieldError(null);
    setSent(null);
    setEditorKey((k) => k + 1);
  }

  // Back on the form after a send, the cursor waits in the summary.
  const wasSent = useRef(false);
  useEffect(() => {
    if (wasSent.current && !sent) document.getElementById("help-summary")?.focus();
    wasSent.current = !!sent;
  }, [sent]);

  // The editor reports what it holds; the send reads it from here.
  const editorRef = useRef<Editor | null>(null);

  // A missing summary or details is said under that field, and the cursor goes
  // there; anything else is said at the top of the request.
  function check(): boolean {
    const ed = editorRef.current;
    const parsed = supportRequestSchema.safeParse({
      requestType: type,
      impact,
      subject,
      html: ed?.getHTML() ?? "",
      text: ed?.getText() ?? "",
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const message = issue?.message ?? "Check the request.";
      const at = issue?.path[0];
      if (at === "subject" || at === "text") {
        const field = at === "subject" ? "subject" : "details";
        setFieldError({ field, message });
        if (field === "subject") document.getElementById("help-summary")?.focus();
        else ed?.commands.focus("end");
      } else setFailure(message);
      return false;
    }
    if (overBudget) {
      setFailure("Attachments exceed 9 MB. Remove a file and try again.");
      return false;
    }
    return true;
  }

  function send(level: Impact) {
    const ed = editorRef.current;
    const fd = new FormData();
    fd.append(
      "request",
      JSON.stringify({
        requestType: type,
        impact: level,
        subject,
        html: ed?.getHTML() ?? "",
        text: ed?.getText() ?? "",
        pagePath: pathname,
        pageLabel,
      }),
    );
    for (const f of files) fd.append("files", f.file, f.file.name);
    setFailure(null);
    setSending(true);
    // Not a transition on purpose: Next keeps a transition pending until it has
    // re-rendered the page underneath, which can take far longer than the send.
    sendSupportRequest(fd)
      .then((res) => {
        setCheckingCritical(false);
        if (res.success) setSent(res.data);
        else setFailure(res.error);
      })
      .catch(() => {
        setCheckingCritical(false);
        setFailure("Support could not be reached. Try again, or email support@cloudxsystems.net.");
      })
      .finally(() => setSending(false));
  }

  const available = context?.available ?? true;
  const noEmail = context ? !context.email : false;
  const blocked = !!contextError || !available || noEmail;
  const canSend = !sending && !blocked && !!context;

  function onSend() {
    if (!canSend || checkingCritical || confirmDiscard) return;
    setFailure(null);
    if (!check()) return;
    if (impact === "blocking") setCheckingCritical(true);
    else send(impact);
  }

  const hint = sent
    ? ""
    : overBudget
      ? `Attachments exceed 9 MB (${formatBytes(filesSize + bodySize)}). Remove a file or screenshot.`
      : "Paste screenshots into Details, or drag files into this window.";

  return (
    <Shell
      title="Help & feedback"
      subtitle="Report an issue or send a request to CloudTime Support."
      icon={<LifeBuoy />}
      onClose={requestClose}
      onSubmit={sent ? undefined : onSend}
      onDrag={setDragging}
      onDropFiles={sent ? undefined : addFiles}
      foot={
        sent ? (
          <>
            <span className={styles.footHint} />
            <Button hierarchy="secondary" onClick={reset}>
              New request
            </Button>
            <Button hierarchy="primary" onClick={onClose} autoFocus>
              Done
            </Button>
          </>
        ) : (
          <>
            <span
              className={styles.footHint}
              data-tone={overBudget ? "warning" : undefined}
              data-tip={overBudget ? undefined : "true"}
            >
              {hint}
            </span>
            <Button hierarchy="tertiary" onClick={requestClose} disabled={sending}>
              Cancel
            </Button>
            <Button
              hierarchy="primary"
              onClick={onSend}
              disabled={!canSend}
              title={`Send (${SEND_KEYS})`}
              leadingIcon={
                sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="h-4 w-4" aria-hidden="true" />
                )
              }
            >
              {sending ? "Sending" : "Send request"}
            </Button>
          </>
        )
      }
    >
      {dragging && !sent && <div className={styles.drop}>Drop files to attach</div>}

      {sent ? (
        <div className={styles.sent} role="status">
          <span className={styles.sentMark} aria-hidden="true">
            <CircleCheckBig />
          </span>
          <h3 className={styles.sentTitle}>Request sent</h3>
          <span className={styles.sentNumber}>Request #{sent.ticketNumber}</span>
          <span className={styles.sentSubject}>{subject.trim()}</span>
          <p className={styles.sentBody}>
            {sent.confirmationSent
              ? `A confirmation was sent to ${sent.confirmationTo}. Reply to that email to add details or follow up.`
              : `Replies will be sent to ${sent.confirmationTo}.`}
          </p>
        </div>
      ) : (
        <div className={styles.panes}>
          {/* ── The message ── */}
          <section className={styles.card} aria-label="Request">
            {contextError && <Banner tone="error" title="Can't send from here" body={contextError} />}
            {context && !available && (
              <Banner
                tone="warning"
                title="Requests unavailable"
                body="Email support@cloudxsystems.net instead."
              />
            )}
            {noEmail && (
              <Banner
                tone="warning"
                title="No email address on your account"
                body="Replies are sent by email. Ask your administrator to add a work or personal email."
              />
            )}
            {failure && <Banner tone="error" title="Not sent" body={failure} />}

            <Input
              id="help-summary"
              label="Summary"
              placeholder="Brief summary of the request"
              value={subject}
              maxLength={300}
              autoFocus
              disabled={sending}
              error={fieldError?.field === "subject" ? fieldError.message : undefined}
              aria-invalid={fieldError?.field === "subject" || undefined}
              onChange={(e) => {
                setSubject(e.target.value);
                if (fieldError?.field === "subject") setFieldError(null);
              }}
            />

            <div className={styles.field}>
              <span className={styles.fieldLabel} id="help-details-label">
                Details
              </span>
              <DetailsEditor
                key={editorKey}
                disabled={sending}
                invalid={fieldError?.field === "details"}
                onReady={(ed) => (editorRef.current = ed)}
                onSize={(n) => {
                  setBodySize(n);
                  setFieldError((prev) => (prev?.field === "details" ? null : prev));
                }}
                onNonImageFiles={addFiles}
                onTooBig={() => setFailure("This image would exceed the 9 MB limit. Attach a smaller one.")}
                budgetLeft={() => SUPPORT_LIMITS.totalBytes - filesSizeRef.current}
              />
              {fieldError?.field === "details" && (
                <span className={styles.fieldError} id="help-details-error">
                  {fieldError.message}
                </span>
              )}
            </div>

            <div className={styles.files}>
              <Button
                hierarchy="secondary"
                size="sm"
                onClick={() => fileInput.current?.click()}
                disabled={sending || files.length >= SUPPORT_LIMITS.files}
                leadingIcon={<Paperclip className="h-4 w-4" aria-hidden="true" />}
              >
                Attach files
              </Button>
              <input
                ref={fileInput}
                type="file"
                multiple
                className="sr-only"
                tabIndex={-1}
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              {files.map((f) => (
                <span key={f.key} className={styles.fileChip}>
                  <span className={styles.fileName} title={f.file.name}>
                    {f.file.name}
                  </span>
                  <span className={styles.fileSize}>{formatBytes(f.file.size)}</span>
                  <button
                    type="button"
                    className={styles.fileRemove}
                    aria-label={`Remove ${f.file.name}`}
                    disabled={sending}
                    onClick={() => setFiles((prev) => prev.filter((p) => p.key !== f.key))}
                  >
                    <X />
                  </button>
                </span>
              ))}
            </div>
          </section>

          {/* ── What kind, how urgent, where the answer goes ── */}
          <aside className={styles.rail} aria-label="Request details">
            <div className={styles.railBlock}>
              <span className={styles.groupLabel} id="help-type">
                Type
              </span>
              <div role="radiogroup" aria-labelledby="help-type" className={styles.choices}>
                {TYPES.map((t) => {
                  const on = type === t.value;
                  return (
                    <label key={t.value} className={styles.choice} data-on={on}>
                      <input
                        type="radio"
                        name="help-type"
                        value={t.value}
                        checked={on}
                        onChange={() => pickType(t.value)}
                        className="sr-only"
                        disabled={sending}
                      />
                      <span className={styles.choiceIcon} aria-hidden="true">
                        <t.icon />
                      </span>
                      <span className={styles.choiceText}>
                        <span className={styles.choiceTitle}>{t.title}</span>
                        <span className={styles.choiceBody}>{t.body}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className={styles.railBlock}>
              <span className={styles.groupLabel}>Impact</span>
              <SegmentedControl
                ariaLabel="Impact"
                fullWidth
                value={impact}
                onChange={(v) => setImpact(v as Impact)}
                items={type === "system_issue" ? IMPACT_ITEMS : IMPACT_ITEMS.filter((i) => i.value !== "blocking")}
              />
              <p className={`${styles.railNote} ${styles.impactNote}`}>{IMPACT_NOTE[impact]}</p>
            </div>

            <div className={styles.railBlock}>
              <span className={styles.groupLabel}>Reporting as</span>
              {context ? (
                <>
                  <div className={styles.who}>
                    <span className={styles.whoMark} aria-hidden="true">
                      {initials(context.name, context.email)}
                      <Face src={photo} />
                    </span>
                    <span className={styles.whoText}>
                      <span className={styles.whoName}>{context.name ?? context.email ?? "You"}</span>
                      <span className={styles.whoEmail} title={context.email ?? undefined}>
                        {context.email ?? "No email address"}
                      </span>
                    </span>
                  </div>
                  <p className={styles.railNote} data-tone={noEmail ? "warning" : undefined}>
                    {noEmail
                      ? "An email address is required to send a request."
                      : "Replies are sent to this address."}
                  </p>
                </>
              ) : (
                <p className={styles.railNote}>{contextError ? "Unavailable" : "Loading"}</p>
              )}
            </div>
          </aside>
        </div>
      )}

      {checkingCritical && (
        <CriticalCheck sending={sending} onBack={() => setCheckingCritical(false)} onSend={send} />
      )}
      {confirmDiscard && (
        <ConfirmDialog
          title="Discard this request?"
          confirmLabel="Discard"
          tone="warning"
          onConfirm={onClose}
          onCancel={() => setConfirmDiscard(false)}
        >
          The text and attachments will be lost.
        </ConfirmDialog>
      )}
    </Shell>
  );
}

/**
 * The details, with the formatting a message needs (bold, italic, underline,
 * lists) and screenshots pasted or dropped straight into the text. A pasted
 * picture travels inside the message; any other file dropped here goes to the
 * attachments.
 */
function DetailsEditor({
  disabled,
  invalid,
  onReady,
  onSize,
  onNonImageFiles,
  onTooBig,
  budgetLeft,
}: {
  disabled: boolean;
  invalid: boolean;
  onReady: (editor: Editor) => void;
  onSize: (bytes: number) => void;
  onNonImageFiles: (files: File[]) => void;
  onTooBig: () => void;
  budgetLeft: () => number;
}) {
  const sizeRef = useRef(0);
  // Set when the editor is made; the paste and drop handlers use it.
  const editorRef = useRef<Editor | null>(null);
  const insertImages = useCallback(
    async (editor: Editor, images: File[]) => {
      for (const file of images) {
        const src = await readAsDataUrl(file);
        if (sizeRef.current + src.length > budgetLeft()) {
          onTooBig();
          return;
        }
        // A line after the picture, with the cursor on it, so typing goes on
        // below it rather than replacing it.
        editor
          .chain()
          .focus()
          .insertContent([{ type: "image", attrs: { src, alt: file.name } }, { type: "paragraph" }])
          .run();
      }
    },
    [budgetLeft, onTooBig],
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        code: false,
        blockquote: false,
        horizontalRule: false,
        // A link in the message is text being written, not somewhere to go.
        link: { openOnClick: false, autolink: true },
      }),
      Image.configure({ allowBase64: true }),
      Placeholder.configure({ placeholder: "Describe the issue or request. For an issue, include the steps taken and the result." }),
    ],
    editorProps: {
      attributes: {
        "aria-labelledby": "help-details-label",
        "aria-describedby": "help-details-error",
        role: "textbox",
        "aria-multiline": "true",
      },
      handlePaste: (_view, event) => {
        const pasted = Array.from(event.clipboardData?.files ?? []);
        if (pasted.length === 0) return false;
        const images = pasted.filter((f) => f.type.startsWith("image/"));
        const others = pasted.filter((f) => !f.type.startsWith("image/"));
        if (others.length) onNonImageFiles(others);
        if (images.length && editorRef.current) void insertImages(editorRef.current, images);
        return true;
      },
      handleDrop: (_view, event) => {
        const dropped = Array.from((event as DragEvent).dataTransfer?.files ?? []);
        if (dropped.length === 0) return false;
        event.preventDefault();
        event.stopPropagation();
        const images = dropped.filter((f) => f.type.startsWith("image/"));
        const others = dropped.filter((f) => !f.type.startsWith("image/"));
        if (others.length) onNonImageFiles(others);
        if (images.length && editorRef.current) void insertImages(editorRef.current, images);
        return true;
      },
    },
    onCreate: ({ editor }) => {
      editorRef.current = editor;
      onReady(editor);
    },
    onUpdate: ({ editor }) => {
      const html = editor.isEmpty ? "" : editor.getHTML();
      sizeRef.current = html.length;
      onSize(html.length);
    },
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  const tool = (label: string, Icon: LucideIcon, active: boolean, run: () => void) => (
    <button
      type="button"
      className={styles.tool}
      data-on={active}
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      // Tab goes from the summary straight into the text; the keys (⌘B, ⌘I,
      // ⌘U, "- " for a list) do the same as these buttons.
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      <Icon />
    </button>
  );

  return (
    <div className={styles.editor} data-disabled={disabled} data-invalid={invalid || undefined}>
      <div className={styles.tools} role="toolbar" aria-label="Formatting">
        {tool("Bold", Bold, !!editor?.isActive("bold"), () => editor?.chain().focus().toggleBold().run())}
        {tool("Italic", Italic, !!editor?.isActive("italic"), () => editor?.chain().focus().toggleItalic().run())}
        {tool("Underline", UnderlineIcon, !!editor?.isActive("underline"), () => editor?.chain().focus().toggleUnderline().run())}
        <span className={styles.toolGap} aria-hidden="true" />
        {tool("Bulleted list", List, !!editor?.isActive("bulletList"), () => editor?.chain().focus().toggleBulletList().run())}
        {tool("Numbered list", ListOrdered, !!editor?.isActive("orderedList"), () => editor?.chain().focus().toggleOrderedList().run())}
      </div>
      <div className={styles.prose} onClick={() => editor?.chain().focus().run()}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

/**
 * Critical alerts the support team at once, so it asks once more: is work
 * actually stopped? Back keeps everything in the request.
 */
function CriticalCheck({
  sending,
  onBack,
  onSend,
}: {
  sending: boolean;
  onBack: () => void;
  onSend: (level: Impact) => void;
}) {
  const [level, setLevel] = useState<"blocking" | "workable">("blocking");
  const options = [
    { value: "blocking" as const, icon: OctagonAlert, title: "Work is stopped", body: "No workaround is available." },
    { value: "workable" as const, icon: CircleCheck, title: "Work can continue", body: "A workaround is available." },
  ];
  return (
    <Shell
      size="small"
      title="Critical impact"
      subtitle="Use Critical only when work is stopped."
      icon={<TriangleAlert />}
      tone="warning"
      onClose={onBack}
      onSubmit={sending ? undefined : () => onSend(level)}
      foot={
        <>
          <span className={styles.footHint}>Going back keeps the request.</span>
          <Button hierarchy="tertiary" onClick={onBack} disabled={sending}>
            Back
          </Button>
          <Button
            hierarchy="primary"
            onClick={() => onSend(level)}
            disabled={sending}
            leadingIcon={
              sending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-4 w-4" aria-hidden="true" />
              )
            }
          >
            {sending ? "Sending" : level === "blocking" ? "Send as critical" : "Send as moderate"}
          </Button>
        </>
      }
    >
      <div className={styles.card}>
        <div role="radiogroup" aria-label="Current impact" className={styles.choices}>
          {options.map((o) => {
            const on = level === o.value;
            return (
              <label key={o.value} className={styles.choice} data-on={on}>
                <input
                  type="radio"
                  name="help-critical"
                  value={o.value}
                  checked={on}
                  onChange={() => setLevel(o.value)}
                  className="sr-only"
                />
                <span className={styles.choiceIcon} aria-hidden="true">
                  <o.icon />
                </span>
                <span className={styles.choiceText}>
                  <span className={styles.choiceTitle}>{o.title}</span>
                  <span className={styles.choiceBody}>{o.body}</span>
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </Shell>
  );
}

/**
 * The frame, as the Export window draws it: a grey window, the header and the
 * footer on the grey. Escape and a click on the backdrop ask the caller to
 * close, which can say no (a written request asks before it is thrown away).
 */
function Shell({
  title,
  subtitle,
  icon,
  tone,
  size,
  foot,
  onClose,
  onSubmit,
  onDrag,
  onDropFiles,
  children,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  tone?: "warning";
  size?: "small";
  foot: ReactNode;
  onClose: () => void;
  /** Command (or Ctrl) and Enter. */
  onSubmit?: () => void;
  onDrag?: (over: boolean) => void;
  onDropFiles?: (files: File[]) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const submitRef = useRef(onSubmit);
  useEffect(() => {
    closeRef.current = onClose;
    submitRef.current = onSubmit;
  }, [onClose, onSubmit]);
  const titleId = `help-${size ?? "main"}-title`;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // Only the window on top answers.
      const windows = document.querySelectorAll("[data-help-window]");
      const win = ref.current;
      if (!win || windows[windows.length - 1] !== win) return;
      // A confirm box open on top (Discard this request?) has the keys.
      if (document.querySelector('[role="alertdialog"]')) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && submitRef.current) {
        e.preventDefault();
        e.stopPropagation();
        submitRef.current();
      } else if (e.key === "Tab") {
        // Tab goes round the window, never out to the page behind it.
        const stops = Array.from(win.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => el.offsetParent !== null || el === document.activeElement,
        );
        if (stops.length === 0) return;
        const first = stops[0]!;
        const last = stops[stops.length - 1]!;
        const at = document.activeElement;
        if (e.shiftKey && (at === first || at === win || !win.contains(at))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (at === last || !win.contains(at))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, []);

  // Files dragged anywhere over the window attach; the editor takes pictures
  // dropped on the text itself.
  const depth = useRef(0);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  const dragProps = onDropFiles
    ? {
        onDragEnter: (e: React.DragEvent) => {
          if (!hasFiles(e)) return;
          depth.current += 1;
          onDrag?.(true);
        },
        onDragLeave: (e: React.DragEvent) => {
          if (!hasFiles(e)) return;
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) onDrag?.(false);
        },
        onDragOver: (e: React.DragEvent) => {
          if (hasFiles(e)) e.preventDefault();
        },
        onDrop: (e: React.DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          depth.current = 0;
          onDrag?.(false);
          onDropFiles(Array.from(e.dataTransfer.files));
        },
      }
    : {};

  // A click on the backdrop closes only when it also started there, so a text
  // selection that ends outside the window doesn't.
  const pressedBackdrop = useRef(false);

  return createPortal(
    <div
      className={`${styles.scrim} ta-sheet-scrim`}
      onMouseDown={(e) => (pressedBackdrop.current = e.target === e.currentTarget)}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressedBackdrop.current) onClose();
        pressedBackdrop.current = false;
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-help-window=""
        data-size={size}
        className={`${styles.window} ta-sheet`}
        {...dragProps}
      >
        <header className={styles.head}>
          <span className={styles.glyph} data-tone={tone} aria-hidden="true">
            {icon}
          </span>
          <span className={styles.titles}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            <span className={`${styles.subtitle} truncate`}>{subtitle}</span>
          </span>
          <Button hierarchy="tertiary" size="sm" iconOnly onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className={`ta-scroll ${styles.body}`}>{children}</div>
        <footer className={styles.foot}>{foot}</footer>
      </div>
    </div>,
    document.body,
  );
}
