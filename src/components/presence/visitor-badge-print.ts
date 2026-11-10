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
  label: "Label",
  card: "ID card",
};

export const PAPER_BODY: Record<BadgePaper, string> = {
  letter: "Office printer, cut to fit a 4 × 3 in badge holder",
  label: "Label printer, 4 × 3 in labels",
  card: "Card printer, CR80 cards",
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

/** The paper remembered on this computer, since a desk's printer does not change between visitors. */
const PAPER_KEY = "cloudtime.visitorBadgePaper";
export function savedPaper(): BadgePaper {
  try {
    const v = window.localStorage.getItem(PAPER_KEY);
    return v === "label" || v === "card" ? v : "letter";
  } catch {
    return "letter";
  }
}
export function rememberPaper(p: BadgePaper): void {
  try {
    window.localStorage.setItem(PAPER_KEY, p);
  } catch {
    // A private window keeps no choice; the default is fine.
  }
}

/**
 * The badge's own typeface: Inter, the app's, served with the app
 * (public/fonts, with its licence). Named here rather than left to the system,
 * because Chrome prints the Mac's system font as Arial: the screen and the
 * paper then wrapped and weighed differently. Arial is the fallback on both,
 * so even without the file they still match.
 */
export const FONT_FAMILY = "CloudTime Badge";
export function fontFace(): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `@font-face { font-family: "${FONT_FAMILY}"; src: url("${origin}/fonts/inter-latin.woff2") format("woff2"); font-weight: 100 900; font-display: block; }`;
}

/** Long names step down a size rather than run onto a fourth line. */
function nameSize(name: string): string {
  const n = name.trim().length;
  return n <= 16 ? "2.15em" : n <= 24 ? "1.8em" : "1.5em";
}

/**
 * One badge, sized by the page it sits on. A draft (New Visitor, before it is
 * saved) shows the empty fields as grey stand ins, so the preview keeps the
 * badge's shape while the form is being filled.
 */
function badgeHtml(b: VisitorBadge, draft: boolean): string {
  const band = badgeBand(b.kind, b.term);
  const q = b.qr.size;
  // Two modules of white around the code: readers need a quiet edge.
  const qr = `<svg viewBox="-2 -2 ${q + 4} ${q + 4}" shape-rendering="crispEdges" aria-hidden="true"><rect x="-2" y="-2" width="${q + 4}" height="${q + 4}" fill="#fff"/><path d="${b.qr.path}" fill="#000"/></svg>`;
  const name = b.name.trim();
  const shownName = name || (draft ? "Full name" : "");
  const company = b.company?.trim() || (draft ? "Company" : "");
  const host = b.visiting?.trim() || (draft ? "Employee name" : "");
  const stand = (real: boolean) => (real ? "" : " stand");
  return `<div class="badge${b.photo ? " withPhoto" : ""}">
  <div class="band" style="background:${band.bg};color:${band.ink}">
    <span class="role">Visitor</span>
    <span class="pass"><span class="kind">${esc(VISITOR_KIND_LABEL[b.kind])}</span><span class="len">${esc(VISITOR_TERM_LABEL[b.term])}</span></span>
  </div>
  <div class="main">
    ${b.photo ? `<div class="photo"><img src="${esc(b.photo)}" alt=""></div>` : ""}
    <div class="text">
      <div class="name${stand(!!name)}" style="font-size:${nameSize(shownName)}">${esc(shownName)}</div>
      ${company ? `<div class="company${stand(!!b.company?.trim())}">${esc(company)}</div>` : ""}
      ${host ? `<div class="pair host"><span class="lbl">Host</span><span class="val${stand(!!b.visiting?.trim())}">${esc(host)}</span></div>` : ""}
    </div>
    <div class="code">${qr}<div class="num">${esc(b.badge)}</div></div>
  </div>
  <div class="foot">
    <div class="pair"><span class="lbl">Valid through</span><span class="date">${esc(dayOf(b.validUntil))}</span></div>
    <div class="pair site"><span class="lbl">Valid only at</span><span class="val">${esc(b.siteName)}</span></div>
  </div>
</div>`;
}

/**
 * Each paper's page and badge. The badge is drawn in em on a base size, so the
 * label and the card are one layout at two scales. The corner is the paper's
 * own: a cut sheet is square, a die cut label and a CR80 card round at 1/8 in.
 */
const PAGE: Record<BadgePaper, { page: string; w: string; h: string; font: string; corner: string }> = {
  letter: { page: "size: letter; margin: 0.5in", w: "4in", h: "3in", font: "10pt", corner: "0" },
  label: { page: "size: 4in 3in; margin: 0", w: "4in", h: "3in", font: "10pt", corner: "0.125in" },
  card: { page: "size: 3.375in 2.125in; margin: 0", w: "3.375in", h: "2.125in", font: "7.1pt", corner: "0.125in" },
};

/** The paper's corner in CSS pixels (96 to the inch), for a preview drawn at a scale. */
export const PAPER_CORNER_PX: Record<BadgePaper, number> = { letter: 0, label: 12, card: 12 };

/**
 * The whole page to print, or with `only: "badge"` the badge alone, exactly as
 * it sits on that page (the previews in New Visitor and Print badge). Both
 * come from here, so the screen cannot drift from the paper.
 */
export function badgeSheet(b: VisitorBadge, paper: BadgePaper, opts: { only?: "badge"; draft?: boolean } = {}): string {
  const p = PAGE[paper];
  const page = opts.only !== "badge";
  const sans = `"${FONT_FAMILY}", Arial, Helvetica, sans-serif`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(b.name)}, ${esc(b.badge)}</title>
<style>
  ${fontFace()}
  @page { ${p.page}; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #fff; color: #141414; }
  body { font: ${p.font}/1.25 ${sans}; font-feature-settings: "tnum" 1, "cv11" 1; -webkit-font-smoothing: antialiased; }
  .sheet { ${page && paper === "letter" ? "display: flex; flex-direction: column; align-items: center; padding-top: 0.25in;" : ""} }
  .cut { position: relative; width: ${p.w}; height: ${p.h}; }
  ${paper === "letter" ? ".cut::after { content: \"\"; position: absolute; inset: 0; border: 1px dashed #8c8c8c; pointer-events: none; }" : ""}
  .badge { width: ${p.w}; height: ${p.h}; display: flex; flex-direction: column; overflow: hidden; background: #fff; border-radius: ${p.corner}; }
  .band { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 1em; height: 4.5em; padding: 0 1.3em; }
  .role { font-weight: 760; font-size: 2.35em; letter-spacing: -0.02em; line-height: 1; }
  .pass { display: flex; flex-direction: column; align-items: flex-end; gap: 0.1em; text-align: right; white-space: nowrap; }
  .kind { font-weight: 600; font-size: 0.85em; line-height: 1.1; opacity: 0.9; }
  .len { font-weight: 760; font-size: 1.3em; line-height: 1.1; letter-spacing: -0.01em; }
  .main { flex: 1; min-height: 0; display: flex; align-items: center; gap: 1.1em; padding: 1em 1.3em; }
  .photo { flex: none; width: 6.2em; height: 7.6em; border-radius: 0.5em; overflow: hidden; background: #f0f0f0; }
  .photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .name { font-weight: 760; line-height: 1.08; letter-spacing: -0.02em; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
  .company { margin-top: 0.3em; font-weight: 500; font-size: 1.15em; line-height: 1.25; color: #3a3a3a; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
  .pair { display: flex; flex-direction: column; min-width: 0; }
  .lbl { font-weight: 600; font-size: 0.8em; line-height: 1.3; color: #6b6b6b; }
  .val { font-weight: 650; font-size: 1.05em; line-height: 1.25; color: #262626; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .host { margin-top: 0.85em; }
  .stand { color: #b4b4b4; }
  .code { flex: none; display: flex; flex-direction: column; align-items: center; gap: 0.3em; }
  .code svg { width: 7.6em; height: 7.6em; display: block; }
  .num { font-weight: 650; font-size: 1em; letter-spacing: 0.06em; }
  .foot { flex: none; display: flex; align-items: flex-end; justify-content: space-between; gap: 1em; padding: 0.75em 1.3em 0.95em; border-top: 1px solid #dcdcdc; }
  .date { font-weight: 760; font-size: 1.6em; line-height: 1.1; letter-spacing: -0.015em; white-space: nowrap; }
  .site { align-items: flex-end; text-align: right; max-width: 50%; }
  .site .val { max-width: 100%; }
  .note { margin: 0.2in 0 0; width: ${p.w}; font: 9pt/1.45 ${sans}; color: #555; text-align: center; }
</style></head><body>
<div class="sheet"><div class="cut">${badgeHtml(b, !!opts.draft)}</div>
${page && paper === "letter" ? `<p class="note">Cut along the dashed line to fit a standard 4 × 3 in badge holder.<br>Print at Actual size (100%), not Fit to page.</p>` : ""}</div>
</body></html>`;
}

/**
 * Prints the sheet from a frame the viewer never sees, as the Export window
 * does (export-table.ts printSheet), once its photo and typeface have loaded,
 * so the badge never prints with an empty box or a stand in font (four
 * seconds at most).
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
  // The photo and the badge's typeface, so it never prints in a stand in font.
  const fonts = doc.fonts
    ? Promise.all([doc.fonts.load(`400 10pt "${FONT_FAMILY}"`), doc.fonts.load(`760 10pt "${FONT_FAMILY}"`)]).then(() => doc.fonts.ready).catch(() => undefined)
    : Promise.resolve();
  const ready = Promise.race([
    Promise.all([
      fonts,
      ...images.map(
        (img) =>
          new Promise((r) => {
            img.addEventListener("load", r, { once: true });
            img.addEventListener("error", r, { once: true });
          }),
      ),
    ]),
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
