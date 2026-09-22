# Design system

CloudTime runs on the **CloudX WMS design system**, ported from the
`User-friendly page design` handoff (Claude Design export, September 2026).

```
npm run design          # writes design-kit.html — open it in a browser
npm run check:design    # asserts the behaviour nothing else can catch
```

`npm run design` renders every component and eight real screens — Punch
History, the hours report, report results, Employees, the Administration hub,
plus their empty states — light and dark, with no server, database or login.
It is also how the font bug below was found.

`npm run check:design` covers two things that type-check, render and lint
identically whether they work or not:

- **⌘K ranking** — that `tmcd` finds Timecards and `payper` finds Pay Periods.
  Hand-written scoring with no check degrades the first time someone adds a
  destination.
- **Nav resolution** — which row highlights and what the breadcrumb says for a
  given path, including that `/payroll` does not claim `/payroll-archive` and
  that a record page still names its section.

Add a case to either when you add a destination.

---

## Where things live

```
src/styles/wms/        tokens, copied verbatim from the handoff
  fonts.css              family variables (see "Fonts" below)
  colors.css             primitives + semantic aliases
  typography.css         the type scale
  spacing.css            spacing, radii, shadows, focus rings
  dark.css               dark-mode semantic aliases (ours, from the handoff)

src/app/globals.css    the bridge: palette mapping, base layer, app CSS classes
src/components/ui/     the React port of the component library
```

The four token files are **copied, not adapted**, so the next export from the
design system diffs cleanly against them. Don't edit them to change how the app
looks — change `globals.css` or the component.

## The one rule

**Consume semantic tokens, never a raw ramp step, never a hex.**

```tsx
color: "var(--text-secondary)"        // yes
background: "var(--surface-card)"     // yes
border: "1px solid var(--stroke-divider)"

color: "var(--wms-color-gray-600)"    // no — ties you to one theme
className="text-[#2492c7]"            // no
```

Semantic aliases flip in dark mode; ramp steps do not. There was exactly one
hardcoded hex in the product (a blue table header in Team Punch History) and it
was the only table in the app that looked different from every other table.

**Blue is the action colour and nothing else.** `--fill-accent` is for buttons
that do something. A selected tab or a chosen toggle is a *selection*, not an
action, and stays neutral.

## Why `zinc-*` still works

The app was written in ~4,800 `zinc-*` and `blue-*` Tailwind utilities. Rather
than rewrite all of them, `globals.css` repoints those two ramps at the design
system's:

```css
@theme {
  --color-zinc-500: var(--wms-color-gray-500);
  --color-blue-600: var(--wms-color-primary-600);
  /* …and the rest, including 25/75/150/350/750 steps Tailwind has no name for */
}
```

So existing markup came onto the design palette without being touched. **New
work should use the semantic tokens**; the ramp aliases exist for the code that
was already here.

## Components

```tsx
import { Button, Badge, Card, Banner, Table, THead, TBody, TFoot, TR, TH, TD,
         Input, Textarea, Select, SearchInput, Checkbox, Switch,
         PageHeader, EmptyState, LinkButton, TableFooter, StatCard,
         SegmentedControl, SegmentedLinks,
         Toolbar, FilterBar, FilterChip, SelectionBar } from "@/components/ui";
```

Prop names match the design system's (`hierarchy`, `tone`, `size`, `variant`)
so a future export maps onto this without a translation layer.

A few conventions worth knowing:

- **`<TD numeric>`** right-aligns and uses tabular figures. Use it for anything
  you'd add up — a column of hours is read down, and the decimals have to line
  up for that to work.
- **`LinkButton`, not `Button`, for navigation.** Middle-click, ctrl-click and
  "open in new tab" are things people use on a row that goes to a timecard; a
  button with a router push has none of them.
- **`readOnly` ≠ `disabled` on a field.** `readOnly` is the design system's
  "Display" state: prepopulated, not editable by *this* user, visibly lighter.
  On a timecard that distinction is real.
- **Empty states say which emptiness it is.** "No exceptions" after filtering to
  one department reads as *this team is clean* when it means *nothing matched*,
  and someone closes a pay period on the strength of it.
- **`Banner` has no dismiss, on purpose.** A banner describes a state — the
  state changing is what removes it. A dismissible "your timesheet was returned"
  lets somebody close the only notice that the period is not finished.
- **`StatCard` takes a `tone`, not a colour.** `success`/`warning`/`error`
  survive a palette change; `text-green-600` does not. And most figures should
  stay default — colouring every number on a dashboard is how it stops meaning
  anything.
- **`.ta-cell` for a cell you can edit inside a grid**, not a form field. A
  timesheet row holds four of them side by side and the full field border turned
  a week of rows into a wall of boxes; the border arrives on hover and focus.

### The list screen has a shape

Twenty-five screens in the handoff are the same template, and they open the
same way. Top to bottom: `PageHeader`, then `Toolbar` carrying the view
segments and the search box with the record count pushed right, then
`FilterBar` of `FilterChip`s for whatever is actually applied, then a
`Card padding={0}` holding `Table` + `TableFooter`, or `EmptyState`.

**The record count is not decoration.** "No exceptions" and "no exceptions
matching these three filters" look identical without it, and the difference
decides whether somebody closes a pay period.

**Filters belong in the query string.** Every list filter in this app is a URL
parameter, which is what makes a filtered list survive a reload and be sendable
to a colleague. That is why there are two segmented controls:

- `SegmentedLinks` — renders anchors, for anything that belongs in the URL.
  Middle-click opens the filtered view in a tab and the server re-runs the
  query.
- `SegmentedControl` — client state, for a genuinely local choice like which
  half of a form you are editing.

Reach for `SegmentedLinks` unless you can say why the choice should be lost on
reload.

**A view tab must not change the query.** Several of these pages are
permission-scoped — a supervisor sees their own team's submitted sheets, payroll
sees every supervisor-approved one. A tab that re-queried would quietly move you
between those two sets while looking like a filter. Narrow the rows you already
loaded.

### There is no underline tab

The design system has a segmented control and nothing else for a small set of
mutually exclusive options. Eight screens here had hand-rolled `border-b-2`
underline tabs; they are all `SegmentedControl` now. If you are about to write
an underline tab, you want `SegmentedControl`.

### Two kinds of table, on purpose

`Table`/`TH`/`TD` is for **list content** — a full-width table of records inside
a Card, with a filled sticky header (11px uppercase on gray-75) and 40px rows.
That is what the design system's Table is, and every list in the product uses
it.

There is a second pattern the kit deliberately does **not** cover: a small
**inline sub-table nested inside a card or a form** — the punch list in the
exception panel, the ledger in leave balances, the day grid in a shift. Those
have a borderless header (no fill, a rule under the row) because a grey band
inside an already-bordered panel reads as a second panel.

Eleven of these exist and they are consistent with each other. Swapping them
for `TH` would put a filled, sticky, 32px header inside a 3-column inline
table — the wrong component, not a missing conversion. Leave them.

### Interaction states are CSS, not utilities

Components set `background` and `color` inline from tokens, and an inline style
beats any `hover:bg-*` class. So hover/focus/pressed live as real CSS in
`globals.css`: `.wms-btn`, `.wms-input`, `.ta-field`, `.ta-hoverable`,
`.ta-outlined`, `.ta-row`, `.ta-hub-card`.

### Large forms

The configuration editors (rule sets, PTO policies, shifts) are hundreds of
fields each and use shared class strings rather than components:

```ts
import { fieldCls, primaryBtnCls, secondaryBtnCls } from "@/components/ui/form-classes";
```

Same tokens, same focus ring, no several-hundred-line diff on the screens that
compute overtime.

## Fonts — read this before touching them

`typography.css` declares `--font-sans: var(--wms-font-sans)` and is imported
**unlayered**, so it outranks Tailwind's layered `@theme` definition of the same
name. Three consequences:

1. `fonts.css` must define `--wms-font-sans` and `--wms-font-mono`. Without
   them the app silently falls back to the browser's default serif — with the
   stylesheet still compiling and every check still green.
2. The next/font variable goes on **`<html>`**, not `<body>`. A `var()` inside a
   custom property resolves where that property is *declared*; `--wms-font-sans`
   is declared on `:root`, so `--font-inter` has to exist there.
3. The `var(--font-inter, "Inter")` fallback is load-bearing. A `var()` with no
   fallback naming an undefined property makes the declaration invalid at
   computed-value time, and an invalid custom property is inherited as invalid
   by everything below it.

To check the whole chain is intact, look for unresolved variables in the
compiled stylesheet — that is what catches this class of bug, not TypeScript.

## Known gaps

- **Editable grid bodies aren't converted.** `rule-sets-manager`,
  `pto-policies-manager`, `shifts-manager` and the two timecard grids still
  hand-roll their rows, where the `<table>` is form layout rather than a list.
  Their headers are done; the cells are a deliberate pass of their own, because
  these are the screens that compute overtime and meal deductions.
- **Three super-admin tables** (`super-admin/tenants`) keep a dark-first header
  and were not part of this work. They are consistent with each other; changing
  them is a decision about how super-admin should look, not a cleanup.
- **The Knowledge Base screen** in the handoff has no data model behind it.
- **The ⌘K palette searches pages only.** The design also searches employees and
  pay periods; that needs an endpoint that doesn't exist.
- **Two permission mechanisms.** The command palette filters with
  `userPermissions.includes(…)` (resolves custom roles); the Administration hub
  uses `hasPermission(effectiveRole, …)` (built-in role only). For a user on a
  custom role they can disagree about which admin pages to list. Pre-existing;
  destination pages enforce their own access either way.
- **Nine `/admin/*` routes are redirect stubs** — sites, departments,
  leave-types, pto-policies, rules, pay-codes, reason-codes, holidays, shifts
  all bounce to `/admin/site-settings`. Link to the real page with its tab
  (`/admin/site-settings?tab=sites`), not the stub.
