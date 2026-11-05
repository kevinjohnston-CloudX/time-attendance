"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Download, FileSpreadsheet, Hourglass, ScanFace, UserX, type LucideIcon } from "lucide-react";
import { Banner, Button, Input, SegmentedControl } from "@/components/ui";
import { getRetentionReview, runRetentionBatch } from "@/actions/privacy.actions";
import { saveFile } from "@/components/presence/export-table";
import { RETENTION_COUNTRY_LABEL } from "@/lib/privacy/retention-rules";
import styles from "@/components/presence/export-window.module.css";
import own from "./person-data-window.module.css";
import { Shell } from "./person-data-window";

/**
 * Retention review, from Company Settings: the leavers past the retention
 * period, or past the photo period, in groups of the oldest 25. HR downloads
 * the group first, then types the number to confirm; the server checks every
 * person again (still due, in reach, in that download) before touching them.
 * Drawn like the Export window: the left card lists the people, the right
 * card holds the two steps.
 */

type Review = Extract<Awaited<ReturnType<typeof getRetentionReview>>, { success: true }>["data"];
type Result = Extract<Awaited<ReturnType<typeof runRetentionBatch>>, { success: true }>["data"];
type Kind = "leavers" | "photos";

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const leftOn = (day: string) =>
  day ? `Left ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`))}` : "";

export function RetentionWindow({ onClose }: { onClose: () => void }) {
  const [review, setReview] = useState<Review | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("leavers");
  const [downloaded, setDownloaded] = useState<Kind | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<"download" | "run" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const load = useCallback(() => {
    setReview(null);
    setLoadError(null);
    getRetentionReview().then(
      (res) => {
        if (!res.success) return setLoadError(res.error);
        setReview(res.data);
        setKind((k) => (k === "leavers" && !res.data.leavers && res.data.photos ? "photos" : k));
      },
      () => setLoadError("The review could not be read. Close this window and try again."),
    );
  }, []);

  useEffect(load, [load]);

  const list = review ? (kind === "leavers" ? review.leavers : review.photos) : null;
  const batch = list?.batch ?? [];
  const isLeavers = kind === "leavers";

  function switchKind(k: Kind) {
    setKind(k);
    setTyped("");
    setFailure(null);
  }

  async function download() {
    setBusy("download");
    setFailure(null);
    try {
      const res = await fetch(`/api/privacy/retention-export?kind=${kind}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const named = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get("content-disposition") ?? "");
      saveFile(await res.blob(), named ? decodeURIComponent(named[1]) : "Retention review.xlsx");
      setDownloaded(kind);
    } catch {
      setFailure("The file could not be made. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function run() {
    setBusy("run");
    setFailure(null);
    const res = await runRetentionBatch({ kind, employeeIds: batch.map((p) => p.id), confirmCount: Number(typed.trim()) });
    setBusy(null);
    if (!res.success) return setFailure(res.error);
    setResult(res.data);
  }

  function nextGroup() {
    setResult(null);
    setDownloaded(null);
    setTyped("");
    load();
  }

  if (result) {
    return (
      <Shell
        title={isLeavers ? "Leavers anonymised" : "Photos deleted"}
        subtitle={plural(result.done, "person", "people")}
        onClose={onClose}
        glyph={<CheckCircle2 />}
        foot={
          <>
            <span className={styles.footHint}>Each one is written to the person&apos;s change history.</span>
            <Button hierarchy="tertiary" onClick={onClose}>
              Close
            </Button>
            <Button hierarchy="primary" onClick={nextGroup}>
              Review the next group
            </Button>
          </>
        }
      >
        <section className={styles.card}>
          <ul className={`${styles.choices} ${own.list}`} aria-label="What was done">
            <Line icon={isLeavers ? UserX : ScanFace} title={isLeavers ? "Anonymised" : "Photos deleted"} body={isLeavers ? "Shown as Former employee and their code from now on" : "Every stored copy"} count={result.done} />
            {result.skipped.map((s, i) => (
              <Line key={`${s.employeeCode}-${i}`} icon={CircleAlert} title={s.name ? `${s.name} · ${s.employeeCode}` : "Skipped"} body={s.reason} />
            ))}
          </ul>
          {result.storageProblems.map((p) => (
            <Banner key={p} tone="warning" title="Not everything was removed from storage" body={p} />
          ))}
        </section>
      </Shell>
    );
  }

  const ready = downloaded === kind;
  const confirmed = ready && batch.length > 0 && typed.trim() === String(batch.length);
  const periodWords = isLeavers
    ? review?.years
      ? `${plural(review.years, "year", "years")} after the end of the year they left${review.country ? `, as ${RETENTION_COUNTRY_LABEL[review.country]} requires` : ""}`
      : ""
    : review
      ? `${review.photoDays} days after they left`
      : "";

  return (
    <Shell
      title="Retention review"
      subtitle={review ? (isLeavers ? "Leavers past the retention period" : "Leaver photos past the photo period") : "Reading the list"}
      onClose={onClose}
      glyph={<Hourglass />}
      foot={
        <>
          <span className={styles.footHint}>
            {batch.length ? "This cannot be undone. The file you download is the only copy." : "Nothing is due right now."}
          </span>
          <Button hierarchy="tertiary" onClick={onClose} disabled={busy !== null}>
            Cancel
          </Button>
          <Button tone="error" onClick={run} disabled={busy !== null || !confirmed}>
            {busy === "run"
              ? isLeavers
                ? "Anonymising"
                : "Deleting"
              : isLeavers
                ? `Anonymise ${plural(batch.length, "person", "people")}`
                : `Delete ${plural(batch.length, "photo", "photos")}`}
          </Button>
        </>
      }
    >
      <div className={styles.panes}>
        <section className={styles.card} aria-label="Who is due">
          {loadError && <Banner tone="error" title="The review could not be read" body={loadError} />}
          {failure && <Banner tone="error" title="Nothing was changed" body={failure} />}
          {review && review.leavers && review.photos && (
            <SegmentedControl
              items={[
                { value: "leavers", label: `Leavers (${review.leavers.count.toLocaleString("en-US")})` },
                { value: "photos", label: `Photos (${review.photos.count.toLocaleString("en-US")})` },
              ]}
              value={kind}
              onChange={(v) => switchKind(v as Kind)}
              ariaLabel="What to review"
            />
          )}
          {list && (
            <div className={styles.group}>
              <span className={styles.groupLabel}>
                {list.count === 0
                  ? "Nobody is due"
                  : list.count > batch.length
                    ? `The oldest ${batch.length} of ${list.count.toLocaleString("en-US")}`
                    : plural(list.count, "person", "people")}
              </span>
              {batch.length === 0 ? (
                <p className={styles.railNote}>
                  {isLeavers ? "Nobody has passed the retention period yet." : "No leaver past the photo period has a photo on file."}
                </p>
              ) : (
                <ul className={`${styles.choices} ${own.list}`} aria-label="People in this group">
                  {batch.map((p) => (
                    <Line key={p.id} icon={isLeavers ? UserX : ScanFace} title={p.name} body={`${p.employeeCode} · ${leftOn(p.leftOn)}`} />
                  ))}
                </ul>
              )}
            </div>
          )}
          {review && !list && <p className={styles.railNote}>{isLeavers ? "Retention period is off." : "Deleting leavers' photos is off."}</p>}
        </section>

        <aside className={styles.rail} aria-label="Steps">
          <div className={`${styles.railBlock} ${styles.previewBlock}`}>
            {periodWords && <p className={styles.railNote}>Listed {periodWords}.</p>}
            <div className={styles.group}>
              <span className={styles.groupLabel}>Step 1. Download</span>
              <div className={styles.file}>
                <span className={styles.fileIcon} data-format="xlsx" aria-hidden="true">
                  <FileSpreadsheet />
                </span>
                <span className={styles.fileText}>
                  <span className={styles.fileName}>{isLeavers ? "Everything held about each person" : "Each person's photo"}</span>
                  <span className={styles.fileMeta}>{ready ? "Downloaded" : `Excel workbook · ${plural(batch.length, "person", "people")}`}</span>
                </span>
              </div>
              <Button
                hierarchy="secondary"
                onClick={download}
                disabled={busy !== null || batch.length === 0}
                leadingIcon={<Download className="h-4 w-4" aria-hidden="true" />}
              >
                {busy === "download" ? "Downloading" : ready ? "Download again" : "Download Excel"}
              </Button>
            </div>
            <div className={styles.group}>
              <span className={styles.groupLabel}>Step 2. Confirm</span>
              {ready ? (
                <Input label={`Type ${batch.length} to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" inputMode="numeric" />
              ) : (
                <p className={styles.railNote}>Download the file first. It is the only copy kept.</p>
              )}
            </div>
            {review && review.noDate > 0 && (
              <p className={styles.railNote}>
                {plural(review.noDate, "leaver has", "leavers have")} no leaving date, so they are never listed. Add the date on their record.
              </p>
            )}
            {isLeavers && <p className={styles.railNote}>Their hours, timesheets, leave and pay history stay. Only who the person was is removed.</p>}
          </div>
        </aside>
      </div>
    </Shell>
  );
}

function Line({ icon: Icon, title, body, count }: { icon: LucideIcon; title: string; body: string; count?: number }) {
  return (
    <li className={`${styles.choice} ${own.item}`}>
      <span className={styles.choiceIcon} aria-hidden="true">
        <Icon />
      </span>
      <span className={styles.choiceText}>
        <span className={`${styles.choiceTitle} truncate`} title={title}>
          {title}
        </span>
        <span className={styles.choiceBody} title={body}>
          {body}
        </span>
      </span>
      {count !== undefined && <span className={styles.choiceCount}>{count.toLocaleString("en-US")}</span>}
    </li>
  );
}
