/**
 * The CloudX WMS design system, as React.
 *
 * <p>Built from the component bundle shipped in the "User-friendly page
 * design" handoff. Measurements, palettes and prop names are the design
 * system's; the implementations are ours, because the handoff ships compiled
 * JSX that expects its own global namespace and a Babel runtime.
 *
 * <p>Everything here consumes semantic tokens (--text-primary, --surface-card,
 * --stroke-divider), never a raw ramp step, so light/dark and any future brand
 * change stay in one place.
 */
export { Button, type ButtonProps } from "./button";
export { LinkButton } from "./link-button";
export { Badge, statusTone, exceptionTone, leaveTone, punchTone, payPeriodTone, type BadgeTone } from "./badge";
export { Card } from "./card";
export { Select, SearchInput } from "./field";
export { Input, Textarea, Checkbox, Switch, type InputProps } from "./input";
export { PageHeader, PinnedBar, EmptyState } from "./page-header";
export { Table, THead, TBody, TFoot, TR, TH, TD, TableFooter } from "./table";
export { SegmentedControl, SegmentedLinks, type SegmentItem } from "./segmented";
export { Toolbar, FilterBar, FilterChip, FilterSelectChip, SortSelectChip, SelectionBar } from "./toolbar";
export { Toast, useToast } from "./toast";
export { StatCard, type StatTone } from "./stat";
export { Banner, type BannerTone } from "./banner";
export { ConfirmDialog } from "./confirm-dialog";
