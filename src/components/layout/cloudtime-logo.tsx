/**
 * CloudTime's mark and wordmark, from the TimeClock handoff.
 *
 * <p>The mark is candidate A, "Clock dial" — the recommended one: a dial, a
 * white hand at twelve, an orange hand at three. The paths below are copied
 * out of the handoff unchanged, and the same three lines appear in its
 * wordmark lockup, so this is the drawing in both places it is specified.
 *
 * <p>Sizes are the handoff's own. It draws the lockup twice, at an 88px tile
 * and a 44px tile, and the two agree exactly: the glyph is 54/88 of the tile,
 * the corner radius a quarter, the wordmark half, and the gap to the wordmark
 * a flat 20px at both sizes. Those numbers are transcribed, not derived — a
 * lockup at any size is the same drawing scaled, never a new one.
 */

/** Glyph 54/88 and radius 22/88 of the tile — the icon itself, unchanged. */
const GLYPH = 54 / 88;
const RADIUS = 0.25;
/**
 * Wordmark 44 against a 64px tile, where the handoff pairs 44 with an 88px one.
 *
 * <p>Its ratio is built around "TIME & ATTENDANCE" on the second line. That
 * descriptor is longer and taller than "Powered by CloudX", and once the
 * shorter line replaced it the type beside the tile lost about a quarter of
 * its height while the tile kept all of its own — leaving a mark standing a
 * head above the words it belongs to.
 *
 * <p>So the tile is sized to the type rather than the other way round: 64 is
 * exactly the height of the wordmark, its gap and the attribution stacked up.
 * The letters are unchanged at every call site — only the tile moved.
 */
const WORDMARK = 44 / 64;
/** Flat 20px beside both the 88px and the 44px tile, so it does not scale. */
const GAP = 20;

/**
 * The dial and its two hands, exactly as the handoff draws them.
 *
 * <p>`onBlue` picks between the two treatments it specifies: white on the
 * brand tile, brand blue on a light surface. The orange hand is the same in
 * both — it is the one brand cue the mark carries.
 */
export function ClockDialMark({ size = 27, onBlue = true }: { size?: number; onBlue?: boolean }) {
  const ink = onBlue ? "#fff" : "var(--ta-brand-blue)";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
      style={{ flex: "none", display: "block" }}
    >
      <circle cx="50" cy="50" r="34" fill="none" stroke={ink} strokeWidth="7" />
      <path d="M50 50 V28" stroke={ink} strokeWidth="7" strokeLinecap="round" />
      <path d="M50 50 H70" stroke="var(--ta-brand-orange)" strokeWidth="7" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The mark on its brand tile — the app icon, at any size.
 *
 * <p>The tile stays #0860AA in both themes. It is a fixed asset with its own
 * white-on-blue contrast, the same fill the launcher background uses, and
 * re-tinting it per theme would make the portal's icon and the tablet's icon
 * two different icons.
 */
export function BrandTile({ size = 44 }: { size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: size * RADIUS,
        background: "var(--ta-brand-blue)",
        display: "grid",
        placeItems: "center",
      }}
    >
      <ClockDialMark size={size * GLYPH} />
    </span>
  );
}

/**
 * "CloudTime" — one word, two colours, never spaced or hyphenated.
 *
 * <p>Set as live text rather than outlines so it stays sharp at 22px in the
 * sidebar and can be selected and read aloud. The tracking step at 40px is the
 * handoff's: -.03em on the 44px wordmark, -.02em on the 22px one.
 *
 * <p>"Cloud" is brand blue on a light surface and white on a dark one. The
 * handoff is explicit that the blue wordmark is never used against a dark
 * background, and the portal's dark theme is exactly the "dark wall" case it
 * has in mind — so this follows a token rather than the brand blue directly.
 */
export function CloudTimeWordmark({ size = 22 }: { size?: number }) {
  return (
    <span
      className="whitespace-nowrap"
      style={{
        font: `var(--weight-bold) ${size}px/1 var(--font-sans)`,
        letterSpacing: size >= 40 ? "-0.03em" : "-0.02em",
      }}
    >
      <span style={{ color: "var(--ta-wordmark-cloud)" }}>Cloud</span>
      <span style={{ color: "var(--ta-brand-orange)" }}>Time</span>
    </span>
  );
}

/**
 * The horizontal lockup: tile, wordmark, and "Powered by CloudX" under it.
 *
 * <p>The descriptor slot is where the handoff sets "Time & Attendance", at
 * 14px against a 44px wordmark, tracked .14em and upper-cased. The line is
 * the attribution instead — the product is CloudTime and who makes it is the
 * thing worth saying twice, where what it does is already the page you are
 * looking at.
 *
 * <p>It also shows at both sizes rather than dropping below a 22px wordmark
 * as the handoff has it. That cutoff exists because "TIME &amp; ATTENDANCE"
 * tracked .14em is wider than the word above it at small sizes; "Powered by
 * CloudX" is shorter and clears it. The 8px floor is the size the portal's
 * own sidebar used for this line before the rebrand, and it is legible.
 */
export function CloudTimeLockup({ size = 44, className }: { size?: number; className?: string }) {
  const wordmark = size * WORDMARK;
  return (
    <span className={`${className ?? "flex"} min-w-0 items-center`} style={{ gap: GAP }}>
      <BrandTile size={size} />
      <span className="flex min-w-0 flex-col" style={{ gap: Math.max(3, wordmark * (6 / 44)) }}>
        <CloudTimeWordmark size={wordmark} />
        <span
          className="whitespace-nowrap uppercase"
          style={{
            font: `var(--weight-medium) ${Math.max(8, Math.round(wordmark * (14 / 44)))}px/1 var(--font-sans)`,
            letterSpacing: "0.14em",
            color: "var(--text-tertiary)",
          }}
        >
          Powered by CloudX
        </span>
      </span>
    </span>
  );
}
