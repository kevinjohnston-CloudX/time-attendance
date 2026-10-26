"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A list's search box that follows the page address without undoing what is
 * being typed. The box sends its search a moment after typing stops, and the
 * address catches up when the results arrive. It used to take every arrival
 * as the new box: typed slowly, 1 then 2 then 3, the results for 1 landed
 * after the 2 was typed and put the box back to 1, and the search ended as
 * 13 (the Employees list, 10/26).
 *
 * <p>So the box takes the address only when the change did not come from it:
 * Back, Clear all, a link. A search it sent landing late is not that. And
 * should an older search's results land after the latest one's, the latest
 * is asked for again, so the list ends on what the box says.
 *
 * @param urlQ   the search in the page address, as the server rendered it
 * @param search sends a search (replacing the address: typing is not history)
 * @param opts.normalize how a search reads in the address, for a screen that
 *   trims it: "john " typed comes back as "john", and is still the box's own
 *   search, so the space stays for the "smith" that follows (the Audit Log).
 */
export function useSearchBox(
  urlQ: string,
  search: (q: string) => void,
  { delayMs = 350, normalize = (q: string) => q }: { delayMs?: number; normalize?: (q: string) => string } = {},
) {
  const [value, setValue] = useState(urlQ);
  // The searches this box has sent since it last took the address, latest
  // last, as they read in the address.
  const [sent, setSent] = useState<string[]>([]);
  const [seenQ, setSeenQ] = useState(urlQ);
  // Whether the latest search's results have arrived.
  const [latestLanded, setLatestLanded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retried = useRef<string | null>(null);
  const latest = sent.length > 0 ? sent[sent.length - 1] : null;
  const arrived = normalize(urlQ);

  // The address changed: one of this box's searches landing leaves the box
  // alone; anything else (Back, Clear all, a link) becomes the box.
  if (urlQ !== seenQ) {
    setSeenQ(urlQ);
    if (arrived === latest) setLatestLanded(true);
    if (!sent.includes(arrived)) {
      setSent([]);
      setValue(urlQ);
    }
  }

  // The latest search's results arrived, then an older one's landed on top:
  // results came back out of order. Ask once more for the latest.
  useEffect(() => {
    if (!latestLanded || latest === null || arrived === latest || !sent.includes(arrived) || retried.current === latest) return;
    retried.current = latest;
    search(latest);
  }, [latestLanded, latest, arrived, sent, search]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function onChange(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const q = normalize(next);
      setSent((s) => [...s.filter((x) => x !== q), q]);
      setLatestLanded(false);
      search(next);
    }, delayMs);
  }

  /** Sets the box without a search of its own (Clear all sends its own). */
  function reset(next = "") {
    if (timer.current) clearTimeout(timer.current);
    setSent([]);
    setLatestLanded(false);
    setValue(next);
  }

  return { value, onChange, reset };
}
