import { FONT_FAMILY, fontFace, printBadgeSheet } from "@/components/presence/visitor-badge-print";

export type IdBadgePaper = "letter" | "card";

export const ID_PAPER_LABEL: Record<IdBadgePaper, string> = {
  letter: "Letter paper",
  card: "ID card",
};
export const ID_PAPER_BODY: Record<IdBadgePaper, string> = {
  letter: "Office printer, cut out to fit a badge holder",
  card: "Card printer, CR80 cards",
};

/** A badge's size standing up, in inches. */
export type BadgeSize = { w: number; h: number };
/** A CR80 card, the size of a credit card: what card printers take. */
export const CR80: BadgeSize = { w: 2.125, h: 3.375 };
/** A visitor's lanyard badge, cut from letter paper for a 3 × 4 in holder. */
export const BADGE_3X4: BadgeSize = { w: 3, h: 4 };

/**
 * Prints the badge exactly as it is drawn on screen: the card itself is
 * copied, with the page's own styles, into a frame the viewer never sees, and
 * scaled whole to a CR80 card standing up. One drawing for the screen and the
 * paper, so they cannot drift apart.
 *
 * <p>Always in light, as a printed card is, and in the badge typeface (Inter,
 * served with the app), because Chrome prints the system font as Arial. On
 * letter paper it sits in a dashed cut line; on a card printer it fills the
 * card.
 */
export function printIdBadge(card: HTMLElement, paper: IdBadgePaper, size: BadgeSize = CR80): void {
  // The card is laid out at its own 400px (My Badge's width), whatever scale
  // the screen shows it at, so the paper gets the same wrapping as My Badge.
  const rect = card.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const width = 400;
  const height = (rect.height / rect.width) * width;
  // 96 CSS pixels to the inch.
  const zoom = Math.min((size.w * 96) / width, (size.h * 96) / height);

  const styles = [...document.querySelectorAll('link[rel="stylesheet"], style')]
    .map((el) => el.outerHTML)
    .join("\n");
  const htmlClass = document.documentElement.className;
  const sans = `"${FONT_FAMILY}", Arial, Helvetica, sans-serif`;
  const letter = paper === "letter";

  const html = `<!doctype html><html lang="en" class="${htmlClass}" data-theme="light"><head><meta charset="utf-8"><title>Badge</title>
${styles}
<style>
  ${fontFace()}
  @page { ${letter ? "size: letter; margin: 0.5in" : "size: ${size.w}in ${size.h}in; margin: 0"}; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  :root { --font-sans: ${sans}; --wms-font-sans: ${sans}; color-scheme: light; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .sheet { ${letter ? "display: flex; flex-direction: column; align-items: center; padding-top: 0.25in;" : ""} }
  .cut { position: relative; display: grid; place-items: center; width: ${size.w}in; height: ${size.h}in; overflow: hidden; }
  ${letter ? '.cut::after { content: ""; position: absolute; inset: 0; border: 1px dashed #8c8c8c; border-radius: 0.125in; pointer-events: none; }' : ""}
  .cut > article { width: ${width}px; max-width: none; margin: 0; box-shadow: none; zoom: ${zoom}; }
</style></head><body>
<div class="sheet"><div class="cut">${card.outerHTML}</div></div>
</body></html>`;
  printBadgeSheet(html);
}
