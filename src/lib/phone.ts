/**
 * The one test for "this is a phone", the same query the stylesheet uses to
 * switch to the phone frame (globals.css, "Phones"). For the few things a
 * stylesheet cannot do, such as scrolling a sheet to what was just picked.
 * Keep the two in step.
 */
export const PHONE_QUERY = "(max-width: 767px), (pointer: coarse) and (max-height: 500px)";

export function isPhone(): boolean {
  return typeof window !== "undefined" && window.matchMedia(PHONE_QUERY).matches;
}
