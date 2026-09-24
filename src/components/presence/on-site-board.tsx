"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Building2, ChevronDown, Clock, DoorOpen, SearchX, UserRoundX } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FilterSelectChip,
  PageHeader,
  SegmentedControl,
  Select,
  Table,
  TableFooter,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Toast,
  useToast,
} from "@/components/ui";
import { findOnSitePeople, getOnSiteBoard } from "@/actions/presence.actions";
import type { PickablePerson } from "@/lib/presence/people-search.service";
import { MAX_PICKED } from "@/lib/presence/search-limits";
import type { PresenceBoard, PresencePerson, PresenceStatus } from "@/lib/presence/types";
import {
  AWAY_STATUSES,
  INSIDE_STATUSES,
  SORT_LABEL,
  SORT_OPTIONS,
  STATUS_META,
  compareBy,
  matchesSearch,
  parseSort,
  readerLines,
  serializeSort,
  showsReaders,
  type ReaderLine,
  type Sort,
  type SortKey,
  fmtDuration,
  fmtShift,
  fmtTime,
  initialsOf,
  minutesSince,
  sinceLine,
  siteDate,
  statusLabel,
} from "./presence-meta";
import { PersonPanel } from "./person-panel";
import { PhotoSwaps, PhotoViewer } from "./face";
import { PeopleSearch, pickedLabel } from "./people-search";
import { clampDay, dayLabel, recentDays } from "@/lib/presence/days";
import { applyHeldOrder, buildSiteDay, countFlags, holdOrder, scanTotals, type HeldOrder } from "@/lib/presence/movements";
import {
  MV_DEFAULT_SORT,
  MV_SORTS,
  MV_SORTS_THAT_MOVE,
  MovementsCounts,
  MovementsEmpty,
  MovementsSkeleton,
  MovementsTable,
  PEOPLE_PER_PAGE,
  SummarySkeleton,
  compareDays,
  flagLabel,
  flagsFor,
  heroFlagFor,
  isViewFlag,
  parseFlag,
  parseMvSort,
  useSiteDay,
  type MvSort,
} from "./movements-view";
import { HomeSiteBadge } from "./home-site";
import {
  ScanLogCounts,
  ScanLogEmpty,
  ScanLogList,
  ScanLogSkeleton,
  counterQuery,
  parseCounter,
  scanLogCsv,
  useScanLog,
  type LogCounter,
} from "./scan-log";
import { UnknownBadgesView, unknownBadgesCsv, useUnknownBadges } from "./unknown-badges";
import styles from "./on-site.module.css";
import { Face } from "./face";

/**
 * The On Site board: who is in one building right now.
 *
 * <p>Laid out as the answer to one question, top to bottom. The headcount
 * says how many people are inside and what they are doing; the counters under
 * it are also the filters, so the number and the way to see those people are
 * the same thing. Below that, faces, grouped by what each person is doing.
 *
 * <p>Refreshes itself every 30 seconds while the tab is visible and stops while
 * it is hidden, so a board left open in a background tab all weekend costs
 * nothing. The filters live in the query string, which is what lets a filtered
 * board survive a reload and be sent to somebody else.
 */

const POLL_MS = 30_000;
/** Past this without a good answer, the board says it is not updating. */
const STALE_MS = 90_000;
const TILES_PER_GROUP = 60;
/** Compact cards are half the size, so a screenful holds twice as many. */
const TILES_PER_GROUP_COMPACT = 120;
const ROWS_PER_PAGE = 200;

type StatusFilter = "all" | "inside" | PresenceStatus;
type View = "photos" | "compact" | "list";
type Tab = "movements" | "people" | "log";

const ALL_STATUSES = [...INSIDE_STATUSES, ...AWAY_STATUSES];
/** The inside statuses that get a headcount card. Salaried people on site are
 *  counted in the building total and listed as a chip, since they need no action. */
const CARD_STATUSES = INSIDE_STATUSES.filter((s) => s !== "ON_SITE");
const CHIP_STATUSES: PresenceStatus[] = ["ON_SITE", ...AWAY_STATUSES];

/** Everyone is the default; "inside" is the building total, picked from its card. */
function parseStatus(raw: string | null): StatusFilter {
  if (raw === "inside") return "inside";
  return raw && (ALL_STATUSES as string[]).includes(raw) ? (raw as PresenceStatus) : "all";
}

const NO_IDS: ReadonlySet<string> = new Set();

export function OnSiteBoard({
  sites,
  initialSiteId,
  initialBoard,
  initialFilters,
  canEditPhotos = false,
}: {
  sites: { id: string; name: string }[];
  initialSiteId: string | null;
  initialBoard: PresenceBoard | null;
  initialFilters: {
    status: string | null;
    dept: string | null;
    shift: string | null;
    view: View;
    sort: string | null;
    group: string | null;
    tab: string | null;
    scans: string | null;
    day: string | null;
    flag: string | null;
    order: string | null;
    open: string | null;
    /** People picked in the search, as ids, from a shared link. */
    people: string | null;
  };
  /** Draws Update photo on the employee panel. The save checks again on the server. */
  canEditPhotos?: boolean;
}) {
  const [siteId, setSiteId] = useState(initialSiteId);
  // Photos saved here, drawn at once on every face until the server's own
  // links carry them.
  const [photoSwaps, setPhotoSwaps] = useState<ReadonlyMap<string, string>>(new Map());
  const toast = useToast();
  const [board, setBoard] = useState(initialBoard);
  const [status, setStatus] = useState<StatusFilter>(parseStatus(initialFilters.status));
  const [dept, setDept] = useState(initialFilters.dept ?? "");
  const [shift, setShift] = useState(initialFilters.shift ?? "");
  const [view, setView] = useState<View>(initialFilters.view);
  const [query, setQuery] = useState("");
  // People picked in the search box. With any picked, every tab shows only
  // them, plus whoever matches what is still being typed.
  const [picked, setPicked] = useState<PickablePerson[]>([]);
  const pickedIds = useMemo(() => new Set(picked.map((p) => p.id)), [picked]);
  // A badge number typed and not yet picked: the server says whose it is
  // (the browser has no badge numbers), and those people match it too.
  const [badgeHit, setBadgeHit] = useState<{ for: string; ids: Set<string> }>({ for: "", ids: new Set() });
  const badgeIds = badgeHit.for && badgeHit.for === query.trim() ? badgeHit.ids : NO_IDS;
  const pickedKey = useMemo(() => [...pickedIds].sort().join(","), [pickedIds]);
  const pickedList = useMemo(() => (pickedKey ? pickedKey.split(",") : []), [pickedKey]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, number>>({});
  const [rowsShown, setRowsShown] = useState(ROWS_PER_PAGE);
  const [sort, setSort] = useState<Sort>(parseSort(initialFilters.sort));
  const [byDept, setByDept] = useState(initialFilters.group === "dept");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // Movements is the page's main view; the cards and the scan log sit beside it.
  const [tab, setTab] = useState<Tab>(
    initialFilters.tab === "log" ? "log" : initialFilters.tab === "people" ? "people" : "movements",
  );
  const [mvShown, setMvShown] = useState(PEOPLE_PER_PAGE);
  const [mvFlag, setMvFlag] = useState(parseFlag(initialFilters.flag));
  const [mvSort, setMvSort] = useState<MvSort>(parseMvSort(initialFilters.order));
  // Everyone's scans open, or each person's on their own. `mvToggled` holds
  // whoever differs from that default, and is cleared when it changes.
  const [mvAllOpen, setMvAllOpen] = useState(initialFilters.open === "all");
  const [mvToggled, setMvToggled] = useState<Set<string>>(new Set());
  const [counter, setCounter] = useState<LogCounter | null>(parseCounter(initialFilters.scans));
  // A past day for the log, or "" for today. The panel opens on the day of
  // the row it was opened from.
  const [logDay, setLogDay] = useState(() =>
    initialBoard ? clampDay(initialFilters.day, siteDate(initialBoard.generatedAt, initialBoard.site.timezone)) ?? "" : "",
  );
  const [panelDay, setPanelDay] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ src: string; name: string; detail: string } | null>(null);

  const [lastOk, setLastOk] = useState(() => (initialBoard ? Date.now() : 0));
  const [failure, setFailure] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [changed, setChanged] = useState<Set<string>>(new Set());

  const inFlight = useRef(false);
  const siteRef = useRef(siteId);
  const previous = useRef(new Map<string, PresenceStatus>());

  // People from a shared link come back with their names from the server,
  // which also drops anyone this site cannot show.
  const restoredPeople = useRef(false);
  useEffect(() => {
    if (restoredPeople.current || !siteId) return;
    restoredPeople.current = true;
    const ids = (initialFilters.people ?? "").split(",").filter(Boolean);
    if (!ids.length) return;
    void findOnSitePeople({ siteId, ids }).then((res) => {
      if (res.success && res.data.kind === "ids") setPicked(res.data.people);
    });
  }, [siteId, initialFilters.people]);

  // ── Filters in the address bar ──────────────────────────────────────────
  // replaceState rather than a navigation: the rows are already here, and a
  // round trip to the server to narrow them would reset the poll and flash the
  // page. The server still reads the same parameters on a reload.
  useEffect(() => {
    const qs = new URLSearchParams();
    if (siteId) qs.set("site", siteId);
    if (status !== "all") qs.set("status", status);
    if (dept) qs.set("dept", dept);
    if (shift) qs.set("shift", shift);
    if (view !== "photos") qs.set("view", view);
    const sortParam = serializeSort(sort);
    if (sortParam) qs.set("sort", sortParam);
    if (byDept) qs.set("group", "dept");
    if (tab !== "movements") qs.set("tab", tab);
    if (tab === "log" && counter) qs.set("scans", counter);
    if (tab !== "people" && logDay) qs.set("day", logDay);
    if (tab === "movements" && mvFlag) qs.set("flag", mvFlag);
    if (tab === "movements" && mvSort !== MV_DEFAULT_SORT) qs.set("order", mvSort);
    if (tab === "movements" && mvAllOpen) qs.set("open", "all");
    if (pickedKey) qs.set("people", pickedKey);
    const next = `${window.location.pathname}?${qs.toString()}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(window.history.state, "", next);
    }
  }, [siteId, status, dept, shift, view, sort, byDept, tab, counter, logDay, mvFlag, mvSort, mvAllOpen, pickedKey]);

  // ── Remember who was where, to mark who just moved ──────────────────────
  const absorb = useCallback((next: PresenceBoard, sameSite: boolean) => {
    const moved = new Set<string>();
    const map = new Map<string, PresenceStatus>();
    for (const p of next.people) {
      map.set(p.id, p.status);
      const before = previous.current.get(p.id);
      if (sameSite && before && before !== p.status) moved.add(p.id);
    }
    previous.current = map;
    setBoard(next);
    if (moved.size) setChanged(moved);
  }, []);

  useEffect(() => {
    if (initialBoard) absorb(initialBoard, false);
    // Only the first snapshot; later ones arrive through refresh().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!changed.size) return;
    const t = setTimeout(() => setChanged(new Set()), 2400);
    return () => clearTimeout(t);
  }, [changed]);

  const refresh = useCallback(
    async (forSite: string, opts: { switching?: boolean } = {}) => {
      if (inFlight.current && !opts.switching) return;
      inFlight.current = true;
      try {
        const res = await getOnSiteBoard({ siteId: forSite });
        // A slow answer for a site somebody has already moved away from is
        // dropped, not drawn over the one they are looking at now.
        if (siteRef.current !== forSite) return;
        if (res.success) {
          absorb(res.data, !opts.switching);
          setLastOk(Date.now());
          setFailure(null);
        } else {
          setFailure(res.error === "FORBIDDEN" || res.error === "NOT_FOUND" ? "access" : "error");
        }
      } catch {
        if (siteRef.current === forSite) setFailure("error");
      } finally {
        inFlight.current = false;
        if (siteRef.current === forSite) setSwitching(false);
      }
    },
    [absorb],
  );

  const lastOkRef = useRef(lastOk);
  useEffect(() => {
    lastOkRef.current = lastOk;
  }, [lastOk]);

  // ── The 30 second poll ──────────────────────────────────────────────────
  useEffect(() => {
    if (!siteId) return;
    const tick = () => {
      if (document.visibilityState === "visible") void refresh(siteId);
    };
    const id = window.setInterval(tick, POLL_MS);
    const onVisibility = () => {
      const visible = document.visibilityState === "visible";
      setHidden(!visible);
      // Coming back to a tab that has been asleep: catch up straight away
      // instead of showing old faces for up to another 30 seconds.
      if (visible && Date.now() - lastOkRef.current > POLL_MS) void refresh(siteId);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [siteId, refresh]);

  // ── The pinned bar ──────────────────────────────────────────────────────
  // The title, the actions and the find row stay on screen while the faces
  // scroll, and shrink to one slim row once the page has moved. Measured the
  // way Leave Requests does it: the distance between the pinned bar and a
  // marker that scrolls away, so it works whichever element is scrolling.
  const barRef = useRef<HTMLDivElement | null>(null);
  const markerRef = useRef<HTMLSpanElement | null>(null);
  const [condensed, setCondensed] = useState(false);

  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      const bar = barRef.current;
      const marker = markerRef.current;
      if (!bar || !marker) return;
      const travelled = bar.getBoundingClientRect().top - marker.getBoundingClientRect().top;
      // Two thresholds, so a page sitting right on the line cannot flicker.
      setCondensed((prev) => (prev ? travelled > 4 : travelled > 16));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // Section headings pin just under the bar, so they need its live height: it
  // shrinks on scroll and wraps on a narrow window.
  const [barHeight, setBarHeight] = useState(0);
  useEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(() => {
      const h = Math.round(el.getBoundingClientRect().height);
      setBarHeight((prev) => (prev === h ? prev : h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The clock the durations and "updated 12 seconds ago" read from.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, []);

  function changeSite(next: string) {
    if (!next || next === siteId) return;
    siteRef.current = next;
    setSiteId(next);
    setSelectedId(null);
    setDept("");
    setShift("");
    setPicked([]);
    setExpanded({});
    setSwitching(true);
    setFailure(null);
    previous.current = new Map();
    void refresh(next, { switching: true });
  }

  // ── Derived rows ────────────────────────────────────────────────────────
  const tz = board?.site.timezone ?? "America/New_York";
  const people = useMemo(() => board?.people ?? [], [board]);

  const departments = useMemo(() => distinct(people, "departmentId", "department"), [people]);
  const shifts = useMemo(() => distinct(people, "shiftId", "shift"), [people]);

  // Department and shift narrow the counts as well as the faces: "how many of
  // Receiving are inside" is a question this page is asked. The search does
  // not, because it is for finding one person, not for counting.
  const scoped = useMemo(
    () => people.filter((p) => (!dept || p.departmentId === dept) && (!shift || p.shiftId === shift)),
    [people, dept, shift],
  );

  const counts = useMemo(() => {
    const c = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<PresenceStatus, number>;
    for (const p of scoped) c[p.status] += 1;
    return c;
  }, [scoped]);

  const insideTotal = scoped.filter((p) => p.inside).length;
  // On the clock and working, not on a meal or break: what the time clock
  // panel on the Scan log leads with.
  const clockNowTotal = scoped.filter((p) => p.clock?.state === "WORK" && !p.clock.automatic).length;
  const outsideOnMeal = scoped.filter((p) => p.outsideOnMeal).length;
  const scheduled = scoped.filter((p) => p.scheduledStart);
  const scheduledArrived = scheduled.filter((p) => p.status !== "NOT_ARRIVED" && p.status !== "ON_LEAVE").length;

  // A search looks at everybody at the site, whichever group is open. The
  // question behind it is "is this person here", and answering "no match"
  // because they happen to have left is the wrong answer to it.
  const needle = query.trim().toLowerCase();
  const searching = needle.length > 0 || pickedIds.size > 0;
  const matches = useMemo(
    () =>
      scoped.filter((p) =>
        searching
          ? pickedIds.has(p.id) || badgeIds.has(p.id) || (!!needle && matchesSearch(p, needle))
          : status === "all"
            ? true
            : status === "inside"
              ? INSIDE_STATUSES.includes(p.status)
              : p.status === status,
      ),
    [scoped, status, needle, searching, pickedIds, badgeIds],
  );

  const groups = useMemo(() => {
    const order = searching || status === "all" ? ALL_STATUSES : status === "inside" ? INSIDE_STATUSES : [status];
    return order
      .map((s) => ({ status: s, people: matches.filter((p) => p.status === s).sort((a, b) => compareBy(sort, a, b)) }))
      .filter((g) => g.people.length > 0);
  }, [matches, status, searching, sort]);

  // The list is one table, so a column sort orders all of it rather than
  // sorting inside each status the way the cards do.
  const listRows = useMemo(
    () => (sort.key === "default" ? groups.flatMap((g) => g.people) : [...matches].sort((a, b) => compareBy(sort, a, b))),
    [groups, matches, sort],
  );

  // The log lives beside the board and shares its search, department and
  // shift, so switching views keeps what you were looking for.
  const log = useScanLog({
    siteId,
    active: tab === "log",
    day: logDay,
    counter,
    departmentId: dept,
    shiftId: shift,
    q: query,
    ids: pickedList,
  });
  const today = board ? siteDate(board.generatedAt, tz) : "";
  // The day already picked stays picked only while it is inside the window.
  const logDayShown = logDay && today && recentDays(today).includes(logDay) ? logDay : "";
  // Badges nobody holds, for the scan log's "Not in CloudTime" chip. Loaded
  // with the log so the chip's count is there before anyone picks it.
  const unknown = useUnknownBadges({ siteId: siteId ?? "", day: logDayShown, active: tab === "log" });
  const when = !logDayShown ? "today" : dayLabel(logDayShown, today) === "Yesterday" ? "yesterday" : `on ${dayLabel(logDayShown, today)}`;

  // ── Movements ──
  const siteDay = useSiteDay({ siteId, active: tab === "movements", day: logDayShown });
  const dayViews = useMemo(
    () => (siteDay.data ? buildSiteDay(siteDay.data, now) : []),
    [siteDay.data, now],
  );
  // Department and shift narrow the counts as well as the table, as on the
  // board; the search is for finding one person and narrows only the table.
  const mvScoped = useMemo(
    () => dayViews.filter((v) => (!dept || v.person.departmentId === dept) && (!shift || v.person.shiftId === shift)),
    [dayViews, dept, shift],
  );
  const mvCounts = useMemo(() => countFlags(mvScoped), [mvScoped]);
  const mvTotals = useMemo(() => scanTotals(mvScoped), [mvScoped]);
  const mvIsToday = !!siteDay.data && siteDay.data.day === siteDay.data.today;
  const mvHasGate = !!siteDay.data?.site.hasGateData;
  // A filter that does not apply to this day (on a meal right now, for
  // yesterday) is set aside rather than answering with an empty table.
  const mvFlagShown =
    mvFlag && siteDay.data && (flagsFor(mvIsToday, mvHasGate).includes(mvFlag) || isViewFlag(mvFlag, mvIsToday))
      ? mvFlag
      : null;
  const mvRows = useMemo(() => {
    const needleMv = query.trim().toLowerCase();
    return mvScoped
      .filter(
        (v) =>
          (!mvFlagShown || v.flags.includes(mvFlagShown)) &&
          ((!needleMv && !pickedIds.size) ||
            pickedIds.has(v.person.id) ||
            badgeIds.has(v.person.id) ||
            (!!needleMv &&
              (v.person.name.toLowerCase().includes(needleMv) ||
                v.person.employeeCode.toLowerCase().includes(needleMv)))),
      )
      .sort(compareDays(mvSort));
  }, [mvScoped, mvFlagShown, query, mvSort, pickedIds, badgeIds]);

  // The order holds still between refreshes, so the row being read never
  // moves under the reader. What changed meanwhile waits behind the "new
  // movements" pill; picking anything (a sort, a filter, a day) or the pill
  // itself sets the order again. Orders a refresh cannot change stay live.
  const mvOrderKey = [siteId, logDayShown, mvSort, mvFlagShown, dept, shift, query.trim(), pickedKey].join("|");
  const [mvFrozen, setMvFrozen] = useState<(HeldOrder & { key: string }) | null>(null);
  const mvHolds = MV_SORTS_THAT_MOVE.includes(mvSort);
  const mvHeld = mvHolds && mvFrozen?.key === mvOrderKey ? mvFrozen : null;
  const mvLoaded = !!siteDay.data;
  useEffect(() => {
    if (!mvHolds || !mvLoaded || mvHeld) return;
    setMvFrozen({ key: mvOrderKey, ...holdOrder(mvRows) });
  }, [mvHolds, mvLoaded, mvHeld, mvOrderKey, mvRows]);
  const { rows: mvDisplayed, moved: mvNewCount } = useMemo(() => applyHeldOrder(mvRows, mvHeld), [mvRows, mvHeld]);
  const logSummary = log.page?.summary ?? null;
  // "Not in CloudTime" counts people, not scans, so it has its own total.
  const logTotal = counter === "unknown" ? unknown.count : logSummary ? counterTotal(logSummary, counter) : 0;

  // Picked people this tab has nothing on, named once so an absence never
  // reads as the search failing. The Scan log only says so once every page
  // of it is loaded, since a person may be further down.
  const pickedAbsent = useMemo(() => {
    if (!picked.length) return [];
    let shown: Set<string> | null = null;
    if (tab === "movements" && siteDay.data) shown = new Set(mvRows.map((v) => v.person.id));
    if (tab === "people" && board) shown = new Set(matches.map((p) => p.id));
    if (tab === "log" && counter !== "unknown" && log.page && !log.page.hasMore) shown = new Set(log.rows.map((r) => r.person.id));
    return shown ? picked.filter((p) => !shown.has(p.id)) : [];
  }, [picked, tab, siteDay.data, mvRows, board, matches, counter, log.page, log.rows]);

  function pickStatus(next: StatusFilter) {
    setQuery("");
    setPicked([]);
    setExpanded({});
    setStatus(next);
  }

  const selected = selectedId ? people.find((p) => p.id === selectedId) ?? null : null;
  const isFiltered = !!dept || !!shift || !!needle || picked.length > 0;
  const siteName = board?.site.name ?? sites.find((s) => s.id === siteId)?.name ?? "";
  /** What the building total card is called, so the header chip can name it the same way. */
  const heroLabel = board?.site.hasGateData === false ? "On the clock" : "In the building";

  // ── Live line ───────────────────────────────────────────────────────────
  const age = lastOk ? now - lastOk : Infinity;
  const liveState: "live" | "stale" | "paused" = hidden ? "paused" : age > STALE_MS || failure === "error" ? "stale" : "live";

  async function exportLog() {
    if (!board) return;
    if (counter === "unknown") {
      if (!unknown.data) return;
      const stamp = logDayShown || `${today} ${fmtTime(board.generatedAt, tz).replace(/[: ]/g, "")}`;
      download(unknownBadgesCsv(unknown.data, csvCell, board.site.name), `Not in CloudTime ${board.site.name} ${stamp}.csv`);
      return;
    }
    const all = await log.fetchAll();
    if (!all) return;
    const csv = scanLogCsv(all.rows, tz, csvCell, board.site.name);
    const stamp = logDayShown || `${today} ${fmtTime(board.generatedAt, tz).replace(/[: ]/g, "")}`;
    download(csv, `Scan log ${board.site.name} ${stamp}.csv`);
  }

  function exportMovements() {
    const data = siteDay.data;
    if (!data) return;
    const tzDay = data.site.timezone;
    const time = (ms: number | null) => (ms === null ? "" : fmtTime(new Date(ms).toISOString(), tzDay));
    const header = ["Name", "Employee code", "Department", "Home site", "Scheduled", "Reader", "Activity", "From", "To", "Minutes", "Notes"];
    const lines: string[][] = [header];
    for (const v of mvDisplayed) {
      const base = [v.person.name, v.person.employeeCode, v.person.department ?? "", v.person.homeSite ?? data.site.name, fmtShift(v.person.scheduledStart, v.person.scheduledEnd) ?? ""];
      if (v.lines.length === 0) {
        lines.push([...base, "", v.person.onLeave ? "On leave" : "Not seen", "", "", "", ""]);
        continue;
      }
      for (const l of v.lines) {
        lines.push([
          ...base,
          l.reader === "gate" ? "Security gate" : "Time clock",
          { INSIDE: "Inside the building", WORK: "On the clock", MEAL: "Meal", BREAK: "Break", EXIT_ONLY: "Left, never scanned in" }[l.kind],
          l.carried ? "Since yesterday" : time(l.start),
          l.end === null ? (data.day === data.today ? "Still going" : "Never scanned out") : time(l.end),
          l.kind === "EXIT_ONLY" ? "" : String(l.minutes),
          l.closedBySystem ? "Closed by the system" : "",
        ]);
      }
    }
    download(lines.map((r) => r.map(csvCell).join(",")).join("\r\n"), `Movements ${data.site.name} ${data.day}.csv`);
  }

  function exportCsv() {
    if (tab === "movements") return exportMovements();
    if (tab === "log") return void exportLog();
    if (!board) return;
    // The export follows what is on screen, in the order it is on screen.
    const rows = listRows;
    const gateData = board.site.hasGateData;
    const header = [
      "Name",
      "Employee code",
      "Department",
      "Home site",
      "Shift",
      "Status",
      ...(gateData ? ["Security gate"] : []),
      "Time clock",
      "Since",
      "First in today",
      "Scheduled",
    ];
    const lines = [header, ...rows.map((p) => [
      p.name,
      p.employeeCode,
      p.department ?? "",
      p.homeSite ?? board.site.name,
      p.shift ?? "",
      statusLabel(p),
      ...readerLines(p, tz, now, gateData).map((l) => l.title.replace(/^[^:]+: /, "")),
      fmtTime(p.since, tz),
      fmtTime(p.firstInToday, tz),
      fmtShift(p.scheduledStart, p.scheduledEnd) ?? "",
    ])];
    const csv = lines.map((r) => r.map(csvCell).join(",")).join("\r\n");
    const stamp = `${siteDate(board.generatedAt, tz)} ${fmtTime(board.generatedAt, tz).replace(/[: ]/g, "")}`;
    download(csv, `Live Attendance ${board.site.name} ${stamp}.csv`);
  }

  // ── No site at all ──────────────────────────────────────────────────────
  if (!siteId || sites.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Header liveLine={null} actions={null} />
        <Card padding={0}>
          <EmptyState
            icon={<Building2 className="h-8 w-8" />}
            title="No sites to show"
            body="You do not have access to any active site. An administrator can add sites to your access in Roles & Permissions."
          />
        </Card>
      </div>
    );
  }

  const liveLine = (
    <span className="inline-flex flex-wrap items-center gap-2">
      {siteName && (
        <span style={{ color: "var(--text-primary)", fontWeight: "var(--weight-medium)" }}>{siteName}</span>
      )}
      <span className={styles.live} data-state={liveState} aria-hidden="true" />
      {liveState === "paused" ? (
        <span>Paused while this tab is in the background</span>
      ) : liveState === "stale" ? (
        <>
          <span style={{ color: "var(--text-warning)" }}>
            {lastOk ? `Not updating. Last updated ${fmtTime(new Date(lastOk).toISOString(), tz)}` : "Not updating"}
          </span>
          <Button hierarchy="link" size="sm" onClick={() => void refresh(siteId)}>
            Try again
          </Button>
        </>
      ) : (
        <span>
          Live · updated {age < 10_000 ? "just now" : `${Math.round(age / 1000)} seconds ago`}
        </span>
      )}
    </span>
  );

  const actions = (
    <>
      <SegmentedControl
        ariaLabel="View"
        items={[
          { value: "movements", label: "Movements" },
          { value: "people", label: "People" },
          { value: "log", label: "Scan log" },
        ]}
        value={tab}
        onChange={(v) => {
          setTab(v as Tab);
          setSelectedId(null);
        }}
      />
      {sites.length > 1 && (
        <Select aria-label="Site" value={siteId} onChange={(e) => changeSite(e.target.value)} style={{ minWidth: 160 }}>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      )}
      <Button
        hierarchy="secondary"
        onClick={exportCsv}
        disabled={
          !board ||
          (tab === "log" ? log.rows.length === 0 : tab === "movements" ? mvRows.length === 0 : matches.length === 0)
        }
      >
        Export
      </Button>
    </>
  );

  return (
    <PhotoSwaps.Provider value={photoSwaps}>
      <div className={`${styles.board} relative flex flex-col gap-4`}>
      <span ref={markerRef} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 h-px w-px" />

      <div ref={barRef} className="sticky top-0 z-20 flex flex-col" style={{ background: "var(--surface-page)" }}>
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-2"
          style={{ paddingTop: condensed ? 8 : 0, paddingBottom: condensed ? 8 : 12, transition: "padding 140ms ease" }}
        >
          <div className="flex min-w-60 flex-1 flex-col gap-0.5">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <h1
                className="truncate"
                style={{
                  margin: 0,
                  fontSize: condensed ? 20 : 30,
                  lineHeight: condensed ? "26px" : "36px",
                  fontWeight: "var(--weight-bold)",
                  letterSpacing: "-0.02em",
                  color: "var(--text-primary)",
                  transition: "font-size 140ms ease, line-height 140ms ease",
                }}
              >
                Live Attendance
              </h1>
              {/* Slim, the bar keeps the one number this page exists for and
                  whether it is still live, and gives up the sentence. */}
              {/* Slim, the Movements bar keeps only whether it is live: the
                  count and the picked filter are already in the row below. */}
              {condensed && board && tab === "movements" && (
                <span
                  className={styles.live}
                  data-state={liveState}
                  title={liveState === "live" ? "Live" : liveState === "paused" ? "Paused" : "Not updating"}
                  aria-label={liveState === "live" ? "Live" : liveState === "paused" ? "Paused" : "Not updating"}
                />
              )}
              {condensed && board && tab === "log" && (
                <span
                  className="tabular inline-flex items-center gap-2 whitespace-nowrap"
                  style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
                >
                  <span className={styles.live} data-state={liveState} aria-hidden="true" />
                  <span>
                    <strong style={{ color: "var(--text-primary)", fontWeight: "var(--weight-semibold)" }}>
                      {logTotal.toLocaleString()}
                    </strong>{" "}
                    {counter === "unknown"
                      ? `not in CloudTime ${when}`
                      : counter
                        ? `${COUNTER_LABEL[counter].toLowerCase()} ${when}`
                        : `scans ${when}`}
                  </span>
                </span>
              )}
              {condensed && board && tab === "people" && (
                <span
                  className="tabular inline-flex items-center gap-2 whitespace-nowrap"
                  style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
                  title={liveState === "live" ? "Live" : liveState === "paused" ? "Paused" : "Not updating"}
                >
                  <span className={styles.live} data-state={liveState} aria-hidden="true" />
                  <span>
                    <strong style={{ color: "var(--text-primary)", fontWeight: "var(--weight-semibold)" }}>
                      {insideTotal.toLocaleString()}
                    </strong>{" "}
                    in the building
                  </span>
                  {!searching && status !== "all" && (
                    <button
                      type="button"
                      className="ta-chip inline-flex items-center gap-1.5 whitespace-nowrap"
                      onClick={() => setStatus("all")}
                      aria-label={`Showing ${status === "inside" ? heroLabel : STATUS_META[status].label}. Show everyone`}
                      style={{
                        height: 24,
                        padding: "0 8px 0 10px",
                        borderRadius: 999,
                        border: "1px solid var(--stroke-secondary)",
                        background: "var(--surface-card)",
                        font: "var(--type-body2)",
                        fontWeight: "var(--weight-medium)",
                        color: "var(--text-secondary)",
                        cursor: "pointer",
                      }}
                    >
                      {status === "inside" ? heroLabel : STATUS_META[status].label}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </span>
              )}
            </div>
            {!condensed && <div style={{ font: "var(--type-body1)", color: "var(--text-secondary)" }}>{liveLine}</div>}
          </div>
          <div className="flex items-center gap-2">{actions}</div>
        </div>

        {board && !switching && failure !== "access" && (
              <div className="flex flex-wrap items-center gap-2.5 pb-3">
                {siteId && (
                  <PeopleSearch
                    siteId={siteId}
                    picked={picked}
                    onPickedChange={(next) => {
                      setPicked(next);
                      setExpanded({});
                    }}
                    text={query}
                    onTextChange={(v) => {
                      setQuery(v);
                      setExpanded({});
                    }}
                    max={MAX_PICKED}
                    onBadgeHolders={(forText, ids) => setBadgeHit({ for: forText, ids: new Set(ids) })}
                  />
                )}
                {departments.length > 0 && (
                  <FilterSelectChip label="Department" value={dept} options={departments} onChange={setDept} />
                )}
                {shifts.length > 0 && <FilterSelectChip label="Shift" value={shift} options={shifts} onChange={setShift} />}
                {tab !== "people" && today && (
                  <DayChip
                    day={logDayShown}
                    today={today}
                    onChange={(d) => {
                      setLogDay(d);
                      setMvShown(PEOPLE_PER_PAGE);
                    }}
                  />
                )}
                {tab === "movements" && mvFlagShown && (
                  <ToggleChip label={flagLabel(mvFlagShown, mvHasGate)} pressed onClick={() => setMvFlag(null)} />
                )}
                {tab === "log" && counter && (
                  <ToggleChip label={COUNTER_LABEL[counter]} pressed onClick={() => setCounter(null)} />
                )}
                {(isFiltered || (tab === "movements" && !!mvFlagShown)) && (
                  <Button
                    hierarchy="link"
                    size="sm"
                    onClick={() => {
                      setQuery("");
                      setPicked([]);
                      setDept("");
                      setShift("");
                      if (tab === "movements") setMvFlag(null);
                    }}
                  >
                    Clear all
                  </Button>
                )}
                <span
                  className="tabular ml-auto whitespace-nowrap"
                  style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}
                >
                  {tab === "movements"
                    ? siteDay.data
                      ? `${mvRows.length.toLocaleString()} ${mvRows.length === 1 ? "person" : "people"}`
                      : ""
                    : tab === "log"
                    ? logSummary
                      ? counter === "unknown"
                        ? `${logTotal.toLocaleString()} ${logTotal === 1 ? "badge" : "badges"}`
                        : `${logTotal.toLocaleString()} ${logTotal === 1 ? "scan" : "scans"}`
                      : ""
                    : searching
                      ? `${matches.length.toLocaleString()} ${matches.length === 1 ? "match" : "matches"} in every group`
                      : `${matches.length.toLocaleString()} ${matches.length === 1 ? "person" : "people"}`}
                </span>
                {tab === "movements" && <MvSortChip sort={mvSort} onChange={setMvSort} />}
                {tab === "movements" && (
                  <ToggleChip
                    label="Expand all"
                    pressed={mvAllOpen}
                    onClick={() => {
                      setMvAllOpen((v) => !v);
                      setMvToggled(new Set());
                    }}
                  />
                )}
                {tab === "people" && <SortChip sort={sort} onChange={setSort} />}
                {tab === "people" && view !== "list" && departments.length > 1 && (
                  <ToggleChip label="By department" pressed={byDept} onClick={() => setByDept((v) => !v)} />
                )}
                {tab === "people" && (
                <SegmentedControl
                  ariaLabel="Layout"
                  size="sm"
                  items={[
                    { value: "photos", label: "Photos" },
                    { value: "compact", label: "Compact" },
                    { value: "list", label: "List" },
                  ]}
                  value={view}
                  onChange={(v) => setView(v as View)}
                />
                )}
              </div>
        )}
        {pickedAbsent.length > 0 && (
          <p className="-mt-1 pb-3" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
            {tab === "people" ? "Not on today's roster: " : tab === "log" ? `No scans ${when} for ` : `No activity ${when} for `}
            {listNames(pickedAbsent.map((p) => pickedLabel(p, picked)))}.
          </p>
        )}
      </div>

      {failure === "access" ? (
        <Card padding={0}>
          <EmptyState
            icon={<Building2 className="h-8 w-8" />}
            title="This site is no longer available to you"
            body="Your access may have changed since the page opened. Pick another site, or reload the page."
          />
        </Card>
      ) : tab === "movements" ? (
        siteDay.failure === "access" ? (
          <Card padding={0}>
            <EmptyState
              icon={<Building2 className="h-8 w-8" />}
              title="This site is no longer available to you"
              body="Your access may have changed since the page opened. Pick another site, or reload the page."
            />
          </Card>
        ) : siteDay.failure === "error" && !siteDay.data ? (
          <Card padding={0}>
            <EmptyState
              icon={<Building2 className="h-8 w-8" />}
              title="Movements could not be loaded"
              body="Something went wrong reading this day's scans. Try again, and if it keeps happening, reload the page."
              action={
                <Button hierarchy="secondary" size="sm" onClick={() => void siteDay.retry()}>
                  Try again
                </Button>
              }
            />
          </Card>
        ) : switching || !board || !siteDay.data ? (
          <MovementsSkeleton />
        ) : (
          <>
          {/* A day with nobody at all is said once, by the empty state, not
              by a panel of zeros above it. */}
          {siteDay.data.people.length > 0 && (
          <MovementsCounts
            views={mvScoped}
            counts={mvCounts}
            isToday={mvIsToday}
            hasGate={mvHasGate}
            flag={mvFlagShown}
            onPick={(f) => {
              setMvFlag(f);
              setMvShown(PEOPLE_PER_PAGE);
            }}
            when={when}
            totals={mvTotals}
            onJump={(c) => {
              setCounter(c);
              setSelectedId(null);
              setTab("log");
            }}
          />
          )}
          {mvRows.length === 0 ? (
          <Card padding={0}>
            <MovementsEmpty
              when={when}
              filtered={!!dept || !!shift || !!query.trim() || picked.length > 0 || !!mvFlagShown}
              onClear={() => {
                setQuery("");
                setPicked([]);
                setDept("");
                setShift("");
                setMvFlag(null);
              }}
            />
          </Card>
        ) : (
          <MovementsTable
            views={mvDisplayed}
            newCount={mvNewCount}
            onShowNew={() => {
              setMvFrozen(null);
              setMvShown(PEOPLE_PER_PAGE);
              document.querySelector('section[aria-label="Movements"]')?.scrollIntoView({ block: "start", behavior: "smooth" });
            }}
            data={siteDay.data}
            now={now}
            stickyTop={barHeight}
            shown={mvShown}
            onShowMore={() => setMvShown((n) => n + PEOPLE_PER_PAGE)}
            selectedId={selectedId}
            onOpen={(id) => {
              setPanelDay(logDayShown || null);
              setSelectedId(id);
            }}
            isOpen={(id) => mvAllOpen !== mvToggled.has(id)}
            onToggle={(id) =>
              setMvToggled((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onZoom={(v, src) =>
              setViewing({
                src,
                name: v.person.name,
                detail: [v.person.employeeCode, v.person.department].filter(Boolean).join(" · "),
              })
            }
          />
          )}
          </>
        )
      ) : tab === "log" ? (
        switching || !board || log.failure === "access" || !log.page || !logSummary ? (
          log.failure === "access" ? (
            <Card padding={0}>
              <EmptyState
                icon={<Building2 className="h-8 w-8" />}
                title="This site is no longer available to you"
                body="Your access may have changed since the page opened. Pick another site, or reload the page."
              />
            </Card>
          ) : log.failure === "error" && !log.page ? (
            <Card padding={0}>
              <EmptyState
                icon={<Building2 className="h-8 w-8" />}
                title="The scan log could not be loaded"
                body="Something went wrong reading today's scans. Try again, and if it keeps happening, reload the page."
                action={
                  <Button hierarchy="secondary" size="sm" onClick={() => void log.retry()}>
                    Try again
                  </Button>
                }
              />
            </Card>
          ) : (
            <ScanLogSkeleton />
          )
        ) : (
          <>
            {(counter !== null ||
              unknown.count > 0 ||
              logSummary.gateTotal + logSummary.clockTotal + logSummary.rejected > 0) && (
              <ScanLogCounts
                summary={logSummary}
                counter={counter}
                onPick={setCounter}
                unknownCount={unknown.count}
                stillInside={when === "today" ? insideTotal : null}
                onStillInside={() => {
                  setMvFlag(when === "today" ? heroFlagFor(true) : "MARKED_OUT");
                  setMvShown(PEOPLE_PER_PAGE);
                  setSelectedId(null);
                  setTab("movements");
                }}
                clockNow={when === "today" ? clockNowTotal : null}
                onClockNow={() => {
                  setMvFlag("ON_CLOCK_NOW");
                  setMvShown(PEOPLE_PER_PAGE);
                  setSelectedId(null);
                  setTab("movements");
                }}
                hasGateData={board.site.hasGateData}
                lastGateScanAt={board.site.lastGateScanAt}
                tz={tz}
                when={when}
              />
            )}
            {counter === "unknown" ? (
              <UnknownBadgesView
                data={unknown.data}
                failed={unknown.failed}
                loading={unknown.loading}
                tz={tz}
                when={when}
                query={query}
                peopleFiltered={!!dept || !!shift}
                onRetry={unknown.retry}
              />
            ) : log.rows.length === 0 ? (
              <Card padding={0}>
                <ScanLogEmpty
                  counter={counter}
                  searching={log.searching}
                  filtered={!!dept || !!shift}
                  hasGateData={board.site.hasGateData}
                  when={when}
                  onClear={() => {
                    setCounter(null);
                    setQuery("");
                    setPicked([]);
                    setDept("");
                    setShift("");
                  }}
                />
              </Card>
            ) : (
              <ScanLogList
                rows={log.rows}
                tz={tz}
                stickyTop={barHeight}
                changed={log.changed}
                selectedId={selectedId}
                onOpen={(id) => {
                  setPanelDay(logDayShown || null);
                  setSelectedId(id);
                }}
                hasMore={log.page.hasMore}
                loadingMore={log.loadingMore}
                onShowMore={() => void log.showMore()}
              />
            )}
          </>
        )
      ) : switching || !board ? (
        <BoardSkeleton />
      ) : (
        <>
          {/* ── Headcount ─────────────────────────────────────────────── */}
          {board.people.length > 0 && (
          <section className={styles.summary} aria-label="Headcount">
            <div
              className={styles.summaryMain}
              data-cards={CARD_STATUSES.filter((s) => board.site.hasGateData || (s !== "NO_GATE_SCAN" && s !== "OFF_CLOCK")).length}
            >
              <button
                type="button"
                className={styles.summaryHero}
                aria-pressed={!searching && status === "inside"}
                onClick={() => pickStatus(status === "inside" ? "all" : "inside")}
                title="Show everyone in the building"
              >
                <span className={styles.summaryLabel}>{heroLabel}</span>
                <span className={styles.summaryHeroFigure}>{insideTotal.toLocaleString()}</span>
                <span className={styles.summarySub}>
                  {scheduled.length === 0
                    ? "Nobody scheduled today"
                    : `${scheduledArrived.toLocaleString()} of ${scheduled.length.toLocaleString()} scheduled have arrived`}
                </span>
              </button>
              {CARD_STATUSES.filter((s) => board.site.hasGateData || (s !== "NO_GATE_SCAN" && s !== "OFF_CLOCK")).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={styles.summaryCard}
                  aria-pressed={!searching && status === s}
                  data-empty={counts[s] === 0 ? "true" : undefined}
                  onClick={() => pickStatus(status === s ? "all" : s)}
                  title={STATUS_META[s].hint}
                >
                  <span className={styles.summaryLabel}>
                    <span className={styles.dot} style={{ background: STATUS_META[s].color }} aria-hidden="true" />
                    <span className="truncate">{STATUS_META[s].heading}</span>
                  </span>
                  <span className={styles.summaryFigure}>{counts[s].toLocaleString()}</span>
                </button>
              ))}
            </div>
            <div className={styles.summaryMore}>
              <div className={styles.summaryChips}>
                <button
                  type="button"
                  className={styles.summaryChip}
                  aria-pressed={!searching && status === "all"}
                  onClick={() => pickStatus("all")}
                  title="Everyone based at this site, and anyone else seen here today"
                >
                  <span>All</span>
                  <span className={styles.summaryChipCount}>{scoped.length.toLocaleString()}</span>
                </button>
                {CHIP_STATUSES.filter((s) => counts[s] > 0 || (!searching && status === s)).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={styles.summaryChip}
                    aria-pressed={!searching && status === s}
                    onClick={() => pickStatus(status === s ? "all" : s)}
                    title={STATUS_META[s].hint}
                  >
                    <span className={styles.dot} style={{ background: STATUS_META[s].color }} aria-hidden="true" />
                    <span>{STATUS_META[s].heading}</span>
                    <span className={styles.summaryChipCount}>{counts[s].toLocaleString()}</span>
                  </button>
                ))}
              </div>
              <span className={styles.summaryNote}>
                {outsideOnMeal > 0 &&
                  `${outsideOnMeal.toLocaleString()} on a break ${outsideOnMeal === 1 ? "is" : "are"} outside the building. `}
                {board.site.hasGateData
                  ? `Last security gate scan at ${fmtTime(board.site.lastGateScanAt, tz)}${
                      board.site.lastGateScanAt && siteDate(board.site.lastGateScanAt, tz) !== siteDate(board.generatedAt, tz)
                        ? " yesterday"
                        : ""
                    }.`
                  : "The security gate has not reported, so this count comes from the time clock."}
              </span>
            </div>
          </section>
          )}

          {/* ── People ────────────────────────────────────────────────── */}
          {matches.length === 0 ? (
            <Card padding={0}>
              <EmptyBoard
                status={status}
                needle={query.trim()}
                pickedNames={picked.map((p) => p.name)}
                filtered={!!dept || !!shift}
                siteName={siteName}
                onClearSearch={() => {
                  setQuery("");
                  setPicked([]);
                }}
              />
            </Card>
          ) : view === "list" ? (
            <Card padding={0}>
              <PeopleTable
                people={listRows}
                hasGateData={board.site.hasGateData}
                sort={sort}
                onSort={setSort}
                tz={tz}
                now={now}
                shown={rowsShown}
                onShowMore={() => setRowsShown((n) => n + ROWS_PER_PAGE)}
                onOpen={(id) => {
                  setPanelDay(null);
                  setSelectedId(id);
                }}
                selectedId={selectedId}
              />
            </Card>
          ) : (
            groups.map((g) => (
              <Section
                key={g.status}
                status={g.status}
                people={g.people}
                byDept={byDept}
                compact={view === "compact"}
                stickyTop={barHeight}
                // A search result is never hidden behind a collapsed heading.
                collapsed={collapsed}
                ignoreCollapsed={searching}
                onToggle={(key) => setCollapsed((c) => ({ ...c, [key]: !c[key] }))}
                expanded={expanded}
                onShowAll={(key, n) => setExpanded((e) => ({ ...e, [key]: n }))}
                renderTile={(p) => (
                  <PersonTile
                    key={p.id}
                    person={p}
                    hasGateData={board.site.hasGateData}
                    tz={tz}
                    now={now}
                    compact={view === "compact"}
                    selected={p.id === selectedId}
                    changed={changed.has(p.id)}
                    onOpen={() => {
                      setPanelDay(null);
                      setSelectedId(p.id);
                    }}
                  />
                )}
              />
            ))
          )}
        </>
      )}

      {selectedId && siteId && board && (
        <PersonPanel
          key={`${selectedId}|${panelDay ?? ""}`}
          siteId={siteId}
          employeeId={selectedId}
          person={selected}
          initialDay={panelDay}
          today={today}
          hasGateData={board.site.hasGateData}
          tz={tz}
          now={now}
          refreshedAt={board?.generatedAt ?? ""}
          onClose={() => setSelectedId(null)}
          onZoom={(src, who) => setViewing({ src, ...who })}
          canEditPhoto={canEditPhotos}
          onPhotoSaved={(id, url) => {
            if (url) setPhotoSwaps((m) => new Map(m).set(id, url));
            toast.flash("Photo updated");
          }}
        />
      )}

      {viewing && (
        <PhotoViewer src={viewing.src} name={viewing.name} detail={viewing.detail} onClose={() => setViewing(null)} />
      )}
      <Toast message={toast.message} />
      </div>
    </PhotoSwaps.Provider>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

function Header({ liveLine, actions }: { liveLine: React.ReactNode; actions: React.ReactNode }) {
  // The title stays the same on every site. Which building the numbers belong
  // to leads the line under it instead, so a long site name never crowds the
  // title and the page reads the same wherever you are.
  return (
    <PageHeader pinned
      title="Live Attendance"
      subtitle={liveLine ?? undefined}
      actions={actions ?? undefined}
    />
  );
}

export function Photo({ person, className, alt = "" }: { person: PresencePerson; className: string; alt?: string }) {
  return (
    <span className={className}>
      <span className={styles.initials} aria-hidden="true">
        {initialsOf(person.name)}
      </span>
      {/* The tablet photo, over the initials, which show whenever there is
          no photo, so nothing moves either way. */}
      <Face src={person.photoUrl} personId={person.id} alt={alt} />
    </span>
  );
}

function PersonTile({
  person: p,
  hasGateData,
  tz,
  now,
  compact,
  selected,
  changed,
  onOpen,
}: {
  person: PresencePerson;
  hasGateData: boolean;
  tz: string;
  now: number;
  compact: boolean;
  selected: boolean;
  changed: boolean;
  onOpen: () => void;
}) {
  const meta = STATUS_META[p.status];
  const mins = minutesSince(p.since, now);
  const line =
    p.status === "ON_MEAL" && mins !== null
      ? `${p.breakKind === "BREAK" ? "Break" : "Meal"} for ${fmtDuration(mins)}`
      : compact && p.lateMinutes !== null
        ? `${fmtDuration(p.lateMinutes)} late`
        : sinceLine(p, tz, new Date(now).toISOString());

  // Compact keeps the face, the name and the one line that matters, and turns
  // the flags into a single corner mark with the reason in its tooltip. The
  // panel still says everything.
  const flags = [
    p.outsideOnMeal ? "Outside the building" : null,
    p.inactive ? "Inactive employee" : null,
    p.homeSite ? `Home site: ${p.homeSite}` : null,
  ].filter(Boolean) as string[];

  // Anybody a reader has seen today gets one line per reader, so the card
  // says what the gate and the clock each think instead of one verdict. The
  // rest (due, on leave) keep the single line, which is all there is to say.
  const readers = showsReaders(p) ? readerLines(p, tz, now, hasGateData) : null;

  return (
    <button
      type="button"
      className={`${styles.tile} ${compact ? styles.tileCompact : ""}`}
      aria-pressed={selected}
      data-changed={changed ? "true" : undefined}
      onClick={onOpen}
      title={[`${p.name} · ${p.employeeCode}`, ...(readers ?? []).map((l) => l.title)].join("\n")}
    >
      <span className={styles.photo}>
        <span className={styles.initials} aria-hidden="true">
          {initialsOf(p.name)}
        </span>
        <Face src={p.photoUrl} personId={p.id} />
        <span
          className={styles.stripe}
          data-dim={p.status === "NO_GATE_SCAN" || p.outsideOnMeal ? "true" : undefined}
          style={{ background: meta.color }}
        />
        {compact ? (
          flags.length > 0 && (
            <span
              className={styles.flagDot}
              data-tone={p.inactive ? "error" : "neutral"}
              title={flags.join(". ")}
              aria-label={flags.join(". ")}
            />
          )
        ) : (
        <span className={styles.flag}>
          {p.outsideOnMeal && (
            <span className={styles.flagChip} data-tone="neutral">
              Outside
            </span>
          )}
          {p.lateMinutes !== null && (
            <span className={styles.flagChip} data-tone="error">
              {fmtDuration(p.lateMinutes)} late
            </span>
          )}
          {p.inactive && (
            <span className={styles.flagChip} data-tone="error">
              Inactive employee
            </span>
          )}
          {p.homeSite && (
            <span className={styles.flagChip} data-tone="neutral" title={`Home site: ${p.homeSite}`}>
              Other site
            </span>
          )}
        </span>
        )}
      </span>
      <span className={styles.tileBody}>
        <span className={styles.name}>{p.name}</span>
        {!compact && (
          <span className={styles.meta}>
            {p.jobTitle ?? p.department ?? p.employeeCode}
            {p.salaried ? " · Salary" : ""}
          </span>
        )}
        {readers && !compact ? (
          <span className={styles.readers}>
            {readers.map((l) => (
              <ReaderRow key={l.reader} line={l} />
            ))}
          </span>
        ) : (
          <span className={styles.since}>
            <span className={styles.dot} style={{ background: meta.color }} aria-hidden="true" />
            <span className={compact && p.lateMinutes !== null ? styles.late : undefined}>{line}</span>
          </span>
        )}
      </span>
    </button>
  );
}

/** One reader's line on a card: its icon, what it says, and when. */
function ReaderRow({ line: l }: { line: ReaderLine }) {
  const Icon = l.reader === "gate" ? DoorOpen : Clock;
  return (
    <span className={styles.reader} data-tone={l.tone ?? undefined}>
      <Icon className={styles.readerMark} aria-label={l.reader === "gate" ? "Security gate" : "Time clock"} />
      <span className={styles.readerWord}>{l.word}</span>
      {l.value && <span className={styles.readerValue}>{l.value}</span>}
    </span>
  );
}

/** A reader's line in the list, as one phrase. */
function ReaderCell({ line: l }: { line: ReaderLine | undefined }) {
  if (!l) return null;
  return (
    <span
      className="tabular"
      title={l.title}
      style={{ color: l.tone ? "var(--text-warning)" : "var(--text-secondary)", whiteSpace: "nowrap" }}
    >
      {l.value ? `${l.word} ${l.value}` : l.word}
    </span>
  );
}

function PeopleTable({
  people,
  hasGateData,
  sort,
  onSort,
  tz,
  now,
  shown,
  onShowMore,
  onOpen,
  selectedId,
}: {
  people: PresencePerson[];
  hasGateData: boolean;
  sort: Sort;
  onSort: (s: Sort) => void;
  tz: string;
  now: number;
  shown: number;
  onShowMore: () => void;
  onOpen: (id: string) => void;
  selectedId: string | null;
}) {
  return (
    <>
      <Table>
        <THead>
          <TR>
            <SortTH label="Employee" sortKey="name" sort={sort} onSort={onSort} />
            <SortTH label="Department" sortKey="department" sort={sort} onSort={onSort} />
            <SortTH label="Status" sortKey="status" sort={sort} onSort={onSort} />
            {hasGateData && <TH>Security gate</TH>}
            <TH>Time clock</TH>
            {/* The reader columns say since when; this says for how long, and
                sorts by it. */}
            <SortTH label="For" sortKey="since" sort={sort} onSort={onSort} />
            <SortTH label="First In" sortKey="arrival" sort={sort} onSort={onSort} />
            <SortTH label="Scheduled" sortKey="scheduled" sort={sort} onSort={onSort} />
          </TR>
        </THead>
        <TBody>
          {people.slice(0, shown).map((p) => {
            const mins = minutesSince(p.since, now);
            const readers = showsReaders(p) ? readerLines(p, tz, now, hasGateData) : [];
            return (
              <TR key={p.id} onClick={() => onOpen(p.id)} selected={p.id === selectedId}>
                <TD>
                  <button
                    type="button"
                    className={`${styles.row} flex min-w-0 max-w-[200px] items-center gap-2.5 border-0 bg-transparent p-0 text-left`}
                    title={p.name}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(p.id);
                    }}
                  >
                    <Photo person={p} className={styles.avatar} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate" style={{ fontWeight: "var(--weight-medium)", color: "var(--text-primary)" }}>
                        {p.name}
                      </span>
                      <span className="tabular" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                        {p.employeeCode}
                      </span>
                    </span>
                  </button>
                </TD>
                <TD style={{ color: "var(--text-secondary)" }}>
                  <div className="max-w-[128px] truncate" title={p.department ?? undefined}>
                    {p.department ?? ""}
                  </div>
                </TD>
                <TD>
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <Badge tone={STATUS_META[p.status].badge} size="sm" dot>
                      {statusLabel(p)}
                    </Badge>
                    {p.lateMinutes !== null && (
                      <span style={{ font: "var(--type-body2)", color: "var(--text-error)", whiteSpace: "nowrap" }}>
                        {fmtDuration(p.lateMinutes)} late
                      </span>
                    )}
                    {p.inactive && (
                      <Badge tone="error" size="sm">
                        Inactive employee
                      </Badge>
                    )}
                    <HomeSiteBadge site={p.homeSite} />
                  </span>
                </TD>
                {hasGateData && (
                  <TD>
                    <ReaderCell line={readers.find((l) => l.reader === "gate")} />
                  </TD>
                )}
                <TD>
                  <ReaderCell line={readers.find((l) => l.reader === "clock")} />
                </TD>
                <TD className="tabular" style={{ whiteSpace: "nowrap" }}>
                  {mins !== null && p.status !== "LEFT" ? fmtDuration(mins) : ""}
                </TD>
                <TD className="tabular" style={{ color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                  {fmtTime(p.firstInToday, tz)}
                </TD>
                <TD style={{ color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                  {fmtShift(p.scheduledStart, p.scheduledEnd) ?? ""}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      <TableFooter
        shown={Math.min(shown, people.length)}
        total={people.length}
        label={people.length === 1 ? "person" : "people"}
      />
      {people.length > shown && (
        <div className="flex justify-center px-4 pb-4">
          <Button hierarchy="secondary" size="sm" onClick={onShowMore}>
            Show {Math.min(ROWS_PER_PAGE, people.length - shown).toLocaleString()} more
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * A column heading you can sort by. Clicking the sorted column again reverses
 * it; the arrow says which way it runs, and aria-sort says the same to a
 * screen reader.
 */
function SortTH({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: Sort;
  onSort: (s: Sort) => void;
}) {
  const active = sort.key === sortKey;
  const Arrow = sort.dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <TH aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className={styles.sortHead}
        data-active={active ? "true" : undefined}
        onClick={() => onSort(active ? { key: sortKey, dir: sort.dir === "asc" ? "desc" : "asc" } : { key: sortKey, dir: "asc" })}
      >
        {label}
        {active && <Arrow className="h-3 w-3" aria-hidden="true" />}
      </button>
    </TH>
  );
}

/**
 * The sort menu, as the same pill the filters use. A real select under the
 * pill, like FilterSelectChip, so the keyboard and the phone list come free.
 * It always has a value, so it never shows a clear button.
 */
function SortChip({ sort, onChange }: { sort: Sort; onChange: (s: Sort) => void }) {
  const options = sort.key === "status" ? [...SORT_OPTIONS, { key: "status" as SortKey, label: "Status" }] : SORT_OPTIONS;
  return (
    <span className={`ta-chip ${styles.pill}`}>
      <span>Sort</span>
      <span className={styles.pillValue}>
        {SORT_LABEL[sort.key]}
        {sort.key !== "default" && sort.dir === "desc" ? ", reversed" : ""}
      </span>
      <ChevronDown className="h-3.5 w-3.5" style={{ color: "var(--icon-tertiary)" }} aria-hidden="true" />
      <select
        aria-label="Sort people by"
        value={sort.key}
        onChange={(e) => onChange({ key: e.target.value as SortKey, dir: "asc" })}
        className={styles.pillSelect}
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}

/** The Movements sort, as the same pill the People sort uses. */
function MvSortChip({ sort, onChange }: { sort: MvSort; onChange: (s: MvSort) => void }) {
  return (
    <span className={`ta-chip ${styles.pill}`}>
      <span>Sort</span>
      <span className={styles.pillValue}>{MV_SORTS.find((o) => o.key === sort)?.label}</span>
      <ChevronDown className="h-3.5 w-3.5" style={{ color: "var(--icon-tertiary)" }} aria-hidden="true" />
      <select
        aria-label="Sort people by"
        value={sort}
        onChange={(e) => onChange(e.target.value as MvSort)}
        className={styles.pillSelect}
      >
        {MV_SORTS.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}

/**
 * Which day the scan log shows, as the same pill the sort uses: today and the
 * six days before, under the names people say them by.
 */
function DayChip({ day, today, onChange }: { day: string; today: string; onChange: (d: string) => void }) {
  return (
    <span className={`ta-chip ${styles.pill}`} data-applied={day ? "true" : undefined}>
      <span>Day</span>
      <span className={styles.pillValue}>{dayLabel(day || today, today)}</span>
      <ChevronDown className="h-3.5 w-3.5" style={{ color: "var(--icon-tertiary)" }} aria-hidden="true" />
      <select
        aria-label="Show scans from"
        value={day || today}
        onChange={(e) => onChange(e.target.value === today ? "" : e.target.value)}
        className={styles.pillSelect}
      >
        {recentDays(today).map((d) => (
          <option key={d} value={d}>
            {dayLabel(d, today)}
          </option>
        ))}
      </select>
    </span>
  );
}

/** An on/off pill in the filter row, drawn like an applied filter when on. */
function ToggleChip({ label, pressed, onClick }: { label: string; pressed: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`ta-chip ${styles.pill}`}
      data-applied={pressed ? "true" : undefined}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {pressed && (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
      {label}
    </button>
  );
}

/**
 * One status group on the board: a heading that pins under the top bar and
 * folds the group away, then the faces, optionally split by department.
 *
 * <p>Folding is per group and per department, keyed by status and department
 * id, so folding Receiving under Working leaves Receiving under Left alone.
 */
function Section({
  status,
  people,
  byDept,
  compact,
  stickyTop,
  collapsed,
  ignoreCollapsed,
  onToggle,
  expanded,
  onShowAll,
  renderTile,
}: {
  status: PresenceStatus;
  people: PresencePerson[];
  byDept: boolean;
  compact: boolean;
  stickyTop: number;
  collapsed: Record<string, boolean>;
  ignoreCollapsed: boolean;
  onToggle: (key: string) => void;
  expanded: Record<string, number>;
  onShowAll: (key: string, n: number) => void;
  renderTile: (p: PresencePerson) => React.ReactNode;
}) {
  const meta = STATUS_META[status];
  const folded = !ignoreCollapsed && !!collapsed[status];
  const perGroup = compact ? TILES_PER_GROUP_COMPACT : TILES_PER_GROUP;
  const depts = byDept ? groupByDepartment(people) : null;

  return (
    <section className={styles.group} aria-label={meta.heading} data-folded={folded ? "true" : undefined}>
      <h2 className={styles.groupHead} style={{ top: stickyTop }}>
        <button type="button" className={styles.groupToggle} aria-expanded={!folded} onClick={() => onToggle(status)}>
          <span className={styles.dot} style={{ background: meta.color }} aria-hidden="true" />
          <span className={styles.groupTitle}>{meta.heading}</span>
          <span className={styles.groupCount}>{people.length.toLocaleString()}</span>
          <span className={styles.groupHint}>{meta.hint}</span>
          <ChevronDown className={styles.chevron} aria-hidden="true" />
        </button>
      </h2>

      {!folded &&
        (depts ? (
          depts.map((d) => {
            const key = `${status}|${d.id}`;
            const dFolded = !ignoreCollapsed && !!collapsed[key];
            return (
              <div key={key} className={styles.dept} data-folded={dFolded ? "true" : undefined}>
                <button type="button" className={styles.deptHead} aria-expanded={!dFolded} onClick={() => onToggle(key)}>
                  <ChevronDown className={styles.chevron} aria-hidden="true" />
                  <span className="truncate">{d.name}</span>
                  <span className={styles.deptCount}>{d.people.length.toLocaleString()}</span>
                </button>
                {!dFolded && (
                  <Tiles
                    people={d.people}
                    limit={expanded[key] ?? perGroup}
                    compact={compact}
                    onShowAll={() => onShowAll(key, d.people.length)}
                    renderTile={renderTile}
                  />
                )}
              </div>
            );
          })
        ) : (
          <Tiles
            people={people}
            limit={expanded[status] ?? perGroup}
            compact={compact}
            onShowAll={() => onShowAll(status, people.length)}
            renderTile={renderTile}
          />
        ))}
    </section>
  );
}

function Tiles({
  people,
  limit,
  compact,
  onShowAll,
  renderTile,
}: {
  people: PresencePerson[];
  limit: number;
  compact: boolean;
  onShowAll: () => void;
  renderTile: (p: PresencePerson) => React.ReactNode;
}) {
  return (
    <>
      <div className={`${styles.grid} ${compact ? styles.gridCompact : ""}`}>{people.slice(0, limit).map(renderTile)}</div>
      {people.length > limit && (
        <div className={styles.more}>
          <span className="tabular" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
            Showing {limit.toLocaleString()} of {people.length.toLocaleString()}
          </span>
          <Button hierarchy="secondary" size="sm" onClick={onShowAll}>
            Show all {people.length.toLocaleString()}
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * Split a group by department, under each department's own name, in name
 * order, with anybody who has none at the end. The people keep the order they
 * were sorted into.
 */
function groupByDepartment(people: PresencePerson[]): { id: string; name: string; people: PresencePerson[] }[] {
  const byId = new Map<string, { id: string; name: string; people: PresencePerson[] }>();
  for (const p of people) {
    const id = p.departmentId ?? "none";
    const entry = byId.get(id) ?? { id, name: p.department ?? "No department", people: [] };
    entry.people.push(p);
    byId.set(id, entry);
  }
  return [...byId.values()].sort((a, b) =>
    a.id === "none" ? 1 : b.id === "none" ? -1 : a.name.localeCompare(b.name),
  );
}

/** "A", "A and B", "A, B and C". */
function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function EmptyBoard({
  status,
  needle,
  pickedNames,
  filtered,
  siteName,
  onClearSearch,
}: {
  status: StatusFilter;
  needle: string;
  pickedNames: string[];
  filtered: boolean;
  siteName: string;
  onClearSearch: () => void;
}) {
  if (needle || pickedNames.length) {
    const who = pickedNames.length === 1 ? pickedNames[0] : "the people you picked";
    return (
      <EmptyState
        icon={<SearchX className="h-8 w-8" />}
        title="No matching people"
        body={
          pickedNames.length && !needle
            ? filtered
              ? `Nobody in the department and shift you have filtered to is ${who}. Clear the filters to see them.`
              : `${pickedNames.length === 1 ? `${who} is not` : `None of ${who} are`} on the ${siteName} roster today. People lists everyone based here and anyone seen here today; Movements and the Scan log reach back further.`
            : filtered
              ? `Nobody in the department and shift you have filtered to matches "${needle}". Clear the filters to search the whole site.`
              : `Nobody at ${siteName} matches "${needle}". The search covers everyone based at this site and anyone else seen here today.`
        }
        action={
          <Button hierarchy="secondary" size="sm" onClick={onClearSearch}>
            Clear search
          </Button>
        }
      />
    );
  }
  const empty: Record<StatusFilter, [string, string]> = {
    all: ["Nobody at this site", `No one is based at ${siteName} or has been seen here today.`],
    inside: ["Nobody is in the building", `No one at ${siteName} is inside or on the clock right now.`],
    WORKING: ["Nobody is working", "No one is on the clock and through the gate right now."],
    NO_GATE_SCAN: ["Everyone clocked in is inside", "Everyone on the clock came in through the security gate."],
    ON_MEAL: ["Nobody is on a break", "Everyone on the clock is working."],
    OFF_CLOCK: ["Everyone inside is clocked in", "Everyone who came in through the security gate is on the clock or has left."],
    ON_SITE: ["No salaried people inside", "No one salaried has come through the gate right now."],
    NOT_ARRIVED: ["Everyone scheduled has arrived", "No one scheduled for today is still missing."],
    LEFT: ["Nobody has left yet", "No one who was here today has gone home."],
    ON_LEAVE: ["Nobody is on leave today", "No approved time off covers today."],
    NOT_SCHEDULED: ["Everyone is scheduled today", "Everyone based at this site has a shift today or has been seen."],
  };
  const [title, body] = empty[status];
  return (
    <EmptyState
      icon={<UserRoundX className="h-8 w-8" />}
      title={title}
      body={filtered ? `${body} This only counts the department and shift you have filtered to.` : body}
    />
  );
}

function BoardSkeleton() {
  const bar = (w: string | number, h: number) => (
    <span className={styles.skeleton} style={{ width: w, height: h }} />
  );
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading Live Attendance">
      <SummarySkeleton cards={4} />
      <div className={styles.group}>
        <div className={styles.groupHead}>{bar(180, 18)}</div>
        <div className={styles.grid}>
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} className="flex flex-col gap-2">
              {bar("100%", 150)}
              {bar("70%", 12)}
              {bar("50%", 10)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

/**
 * Filter options from the people on the board, under their own names. Only
 * departments and shifts somebody is actually in are offered, so no choice in
 * the list can only ever come back empty.
 */
function distinct(
  people: PresencePerson[],
  idKey: "departmentId" | "shiftId",
  nameKey: "department" | "shift",
): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const p of people) {
    const id = p[idKey];
    const name = p[nameKey];
    if (id && name && !seen.has(id)) seen.set(id, name);
  }
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

const COUNTER_LABEL: Record<LogCounter, string> = {
  gate: "Security gate scans",
  "gate-in": "Security gate in",
  "gate-out": "Security gate out",
  clock: "Time clock scans",
  "clock-in": "Time clock in",
  "clock-out": "Time clock out",
  rejected: "Taps not counted",
  unknown: "Not in CloudTime",
  "first-in": "First entry per person",
  "first-clock": "First clock in per person",
  missed: "Missed gate scans",
};

/** How many scans the picked counter stands for, from the same counts it shows. */
function counterTotal(s: NonNullable<ReturnType<typeof useScanLog>["page"]>["summary"], c: LogCounter | null): number {
  const { stream, direction, rejected, first, missed } = counterQuery(c);
  if (rejected) return s.rejected;
  if (missed) return s.missedGate;
  if (first) return first === "gate" ? s.peopleIn : s.peopleClockedIn;
  if (stream === "SECURITY") return direction === "IN" ? s.gateIn : direction === "OUT" ? s.gateOut : s.gateTotal;
  if (stream === "TIME_CLOCK") return direction === "IN" ? s.clockIn : direction === "OUT" ? s.clockOut : s.clockTotal;
  return s.gateTotal + s.clockTotal;
}

function download(csv: string, name: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(v: string): string {
  const s = String(v ?? "");
  // A leading = + - or @ is read as a formula by spreadsheet programs.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
