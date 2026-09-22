import { BrandTile, CloudTimeLockup } from "./cloudtime-logo";

/**
 * CloudTime, as it appears in the portal chrome.
 *
 * <p>The artwork is the handoff's — see {@link ./cloudtime-logo}. It replaces
 * a hand-drawn 3x3 dot grid on a near-black tile, which stood in for the real
 * mark and shared no colour, shape or proportion with the icon an employee
 * taps to clock in.
 *
 * <p>The wordmark sizes are the handoff's — 44px on sign-in, 22px in the
 * sidebar. The tiles beside them are sized to the type rather than to the
 * handoff's 2:1, for the reason set out in {@link ./cloudtime-logo}. The
 * collapsed rail is the one case with no lockup at all: 30px is what fits the
 * 36px gutter, and the tile scales as a whole.
 */

/** The bare tile, for the collapsed rail — 30px inside a 36px gutter. */
export function BrandIcon() {
  return <BrandTile size={30} />;
}

/** Wordmark at 22px, attribution at 8px — a 32px tile beside them. */
export function BrandMark() {
  return <CloudTimeLockup size={32} />;
}

/**
 * Wordmark at 44px, attribution at 14px — a 64px tile beside them.
 *
 * <p>Sign-in and the error screens are the only places that carry it. They
 * earn it: they are the screens somebody can arrive at without having signed
 * in, and the only ones that have to say what this product is rather than
 * assume you already know.
 *
 * <p>The lockup measures 295px and these screens give it the viewport less a
 * 24px gutter each side, so it needs 343px to sit on one line — under that it
 * clips mid-word, which a 320px phone does. The breakpoint is 360 rather than
 * Tailwind's `sm`: at 640 it would drop every ordinary phone to the small
 * lockup to spare the handful that genuinely cannot hold the large one.
 */
export function BrandLockup() {
  return (
    <>
      <CloudTimeLockup size={64} className="hidden min-[360px]:flex" />
      <CloudTimeLockup size={48} className="flex min-[360px]:hidden" />
    </>
  );
}
