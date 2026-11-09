import { VISITOR_KIND_LABEL, VISITOR_TERM_LABEL, type VisitorKind, type VisitorTerm } from "@/lib/visitors/visitor-pass";
import type { VisitorBadge } from "@/lib/visitors/visitors.service";

/**
 * A visitor's badge as a printed page, for any printer (Juan, 2026-11-06:
 * plain office printers today, so it must work with anything).
 *
 * <p>Three papers. Letter paper, the default: the badge at 4 × 3 in, the size
 * of a standard horizontal badge holder, inside a dashed line to cut along.
 * A 4 × 3 in label, for a label printer. A CR80 card (3.375 × 2.125 in), for an
 * ID card printer. Each sets its own page size, so the print window opens on
 * the right paper.
 *
 * <p>The band says what the pass is in words as well as colour: a black and
 * white printer loses the colour and keeps the words. The last day is the
 * largest line after the name, as a guard checks it at a glance. The code is
 * the badge number, as the gate reads every badge.
 *
 * <p>Plain colours, not the app's tokens: paper is always white and has no
 * dark mode, as with the Export window's printed sheet (export-table.ts).
 */

export type BadgePaper = "letter" | "label" | "card";

export const PAPER_LABEL: Record<BadgePaper, string> = {
  letter: "Letter paper",
  label: "Label, 4 × 3 in",
  card: "ID card printer",
};

export const PAPER_BODY: Record<BadgePaper, string> = {
  letter: "Any office printer. Cut out for a badge holder",
  label: "A label printer loaded with 4 × 3 in labels",
  card: "A plastic card printer (CR80, 3.375 × 2.125 in)",
};

/**
 * The band's colour: day passes by length, frequent visitors in the visitor
 * orange of My Badge. The New Visitor preview uses the same, so it shows the
 * badge as it prints.
 */
const BAND: Record<"FREQUENT" | VisitorTerm, { bg: string; ink: string }> = {
  FREQUENT: { bg: "#F7931E", ink: "#111111" },
  SIX_MONTHS: { bg: "#F7931E", ink: "#111111" },
  ONE_YEAR: { bg: "#F7931E", ink: "#111111" },
  TWO_YEARS: { bg: "#F7931E", ink: "#111111" },
  DAY: { bg: "#DC2626", ink: "#FFFFFF" },
  WEEK: { bg: "#2563EB", ink: "#FFFFFF" },
  MONTH: { bg: "#7C3AED", ink: "#FFFFFF" },
};

/** The printed band's colours for a pass. */
export function badgeBand(kind: VisitorKind, term: VisitorTerm): { bg: string; ink: string } {
  return kind === "FREQUENT" ? BAND.FREQUENT : BAND[term];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const dayLong = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const dayOf = (d: string) => dayLong.format(new Date(`${d}T00:00:00.000Z`));

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** One badge, sized by the page it sits on. */
function badgeHtml(b: VisitorBadge): string {
  const band = badgeBand(b.kind, b.term);
  const q = b.qr.size;
  // Two modules of white around the code: readers need a quiet edge.
  const qr = `<svg viewBox="-2 -2 ${q + 4} ${q + 4}" shape-rendering="crispEdges" aria-hidden="true"><rect x="-2" y="-2" width="${q + 4}" height="${q + 4}" fill="#fff"/><path d="${b.qr.path}" fill="#000"/></svg>`;
  const photo = b.photo
    ? `<div class="photo"><img src="${esc(b.photo)}" alt=""></div>`
    : "";
  return `<div class="badge${b.photo ? " withPhoto" : ""}">
  <div class="band" style="background:${band.bg};color:${band.ink}">
    <span class="role">VISITOR</span>
    <span class="len">${esc(VISITOR_KIND_LABEL[b.kind])} · ${esc(VISITOR_TERM_LABEL[b.term])}</span>
  </div>
  <div class="main">
    ${photo || `<div class="photo none"><span>${esc(initials(b.name))}</span></div>`}
    <div class="text">
      <div class="name">${esc(b.name)}</div>
      ${b.company ? `<div class="company">${esc(b.company)}</div>` : ""}
      ${b.visiting ? `<div class="visiting">Visiting ${esc(b.visiting)}</div>` : ""}
    </div>
    <div class="code">${qr}<div class="num">${esc(b.badge)}</div></div>
  </div>
  <div class="foot">
    <div class="until"><span class="lbl">Valid through</span><span class="date">${esc(dayOf(b.validUntil))}</span></div>
    <div class="site">${esc(b.siteName)}<br><span class="only">This building only</span></div>
  </div>
</div>`;
}

const PAGE: Record<BadgePaper, { page: string; w: string; h: string; font: string }> = {
  letter: { page: "size: letter; margin: 0.5in", w: "4in", h: "3in", font: "10pt" },
  label: { page: "size: 4in 3in; margin: 0", w: "4in", h: "3in", font: "10pt" },
  card: { page: "size: 3.375in 2.125in; margin: 0", w: "3.375in", h: "2.125in", font: "7.1pt" },
};

/** The whole page to print. */
export function badgeSheet(b: VisitorBadge, paper: BadgePaper): string {
  const p = PAGE[paper];
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(b.name)} · ${esc(b.badge)}</title>
<style>
  @page { ${p.page}; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #fff; color: #111; }
  body { font: ${p.font}/1.25 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
  .cut { width: ${p.w}; height: ${p.h}; ${paper === "letter" ? "outline: 1px dashed #888; outline-offset: 0;" : ""} }
  .badge { width: ${p.w}; height: ${p.h}; display: flex; flex-direction: column; overflow: hidden; background: #fff; }
  .band { display: flex; align-items: baseline; justify-content: space-between; gap: 0.8em; padding: 0.55em 0.9em; }
  .role { font-weight: 800; font-size: 2.1em; letter-spacing: 0.06em; line-height: 1; }
  .len { font-weight: 700; font-size: 1.15em; white-space: nowrap; }
  .main { flex: 1; min-height: 0; display: flex; align-items: center; gap: 0.9em; padding: 0.7em 0.9em 0.4em; }
  .photo { flex: none; width: 6.2em; height: 7.4em; border-radius: 0.4em; overflow: hidden; background: #f1f1f1; display: grid; place-items: center; }
  .photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .photo.none span { font-weight: 700; font-size: 2.2em; color: #777; }
  .text { flex: 1; min-width: 0; }
  .name { font-weight: 800; font-size: 1.9em; line-height: 1.1; overflow-wrap: anywhere; }
  .company { margin-top: 0.25em; font-size: 1.2em; color: #333; overflow-wrap: anywhere; }
  .visiting { margin-top: 0.35em; font-size: 1em; color: #555; overflow-wrap: anywhere; }
  .code { flex: none; display: flex; flex-direction: column; align-items: center; gap: 0.2em; }
  .code svg { width: 7.4em; height: 7.4em; display: block; }
  .num { font-weight: 700; font-size: 1em; letter-spacing: 0.08em; font-variant-numeric: tabular-nums; }
  .foot { display: flex; align-items: flex-end; justify-content: space-between; gap: 0.8em; padding: 0.45em 0.9em 0.6em; border-top: 1px solid #ccc; }
  .until { display: flex; flex-direction: column; }
  .lbl { font-size: 0.8em; font-weight: 700; color: #555; }
  .date { font-size: 1.6em; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1.1; }
  .site { text-align: right; font-size: 0.95em; font-weight: 600; color: #333; }
  .only { font-size: 0.85em; font-weight: 400; color: #666; }
  .note { margin-top: 0.18in; width: ${p.w}; font: 9pt/1.4 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #555; }
</style></head><body>
<div class="cut">${badgeHtml(b)}</div>
${paper === "letter" ? `<p class="note">Cut along the dashed line. It fits a standard 4 × 3 in badge holder. Print at Actual size (100%), not Fit to page.</p>` : ""}
</body></html>`;
}

/**
 * Prints the sheet from a frame the viewer never sees, as the Export window
 * does (export-table.ts printSheet), once its photo has loaded, so the badge
 * never prints with an empty box (four seconds at most).
 */
export function printBadgeSheet(html: string): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  const done = () => setTimeout(() => frame.remove(), 500);
  win.addEventListener("afterprint", done, { once: true });
  const images = [...doc.images].filter((img) => !img.complete);
  const ready = Promise.race([
    Promise.all(
      images.map(
        (img) =>
          new Promise((r) => {
            img.addEventListener("load", r, { once: true });
            img.addEventListener("error", r, { once: true });
          }),
      ),
    ),
    new Promise((r) => setTimeout(r, 4000)),
  ]);
  void ready.then(() =>
    setTimeout(() => {
      win.focus();
      win.print();
      // Some browsers never fire afterprint for a frame; tidy up regardless.
      setTimeout(done, 60_000);
    }, 50),
  );
}
