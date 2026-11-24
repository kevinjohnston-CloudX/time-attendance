/**
 * One date formatter per locale and set of options, built once and reused.
 *
 * <p>Building an Intl.DateTimeFormat is costly (it loads the time zone's
 * rules and the locale's patterns); using one is cheap. A report that built
 * one per punch built 57,000 for a week of the company, about half of all
 * its work on a Mac and enough on the live server to run past its 5 minute
 * limit (Nov 24, 2026). A formatter holds no state between calls, so sharing
 * one is safe.
 *
 * <p>The options are keyed in the order they are written, so the same call
 * site always finds its own. Kept to a few hundred entries: a key is a
 * locale, a time zone and a handful of fields, so a real app never comes
 * near it, and anything that did would rebuild rather than grow.
 */
const MAX = 500;
const cache = new Map<string, Intl.DateTimeFormat>();

export function dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = cache.get(key);
  if (!format) {
    if (cache.size >= MAX) cache.clear();
    format = new Intl.DateTimeFormat(locale, options);
    cache.set(key, format);
  }
  return format;
}
