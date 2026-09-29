"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LinkPendingSpinner, useRouter } from "@/components/layout/navigation-progress";
import { useRef, useState, useEffect, useTransition } from "react";
import { signOut } from "next-auth/react";
import { LogOut, Eye, X, Search, ChevronsUpDown, TriangleAlert } from "lucide-react";
import { setViewAsRole, clearViewAsRole } from "@/actions/view-as.actions";
import { BrandTile } from "./cloudtime-logo";
import { openCommandPalette } from "./command-palette";
import { useNavMode, useSidebarCollapsed } from "./nav-mode";
import {
  SECTIONS,
  type NavItem,
  ROLE_LABEL,
  INACTIVE_ALLOWED_HREFS,
  activeHref,
} from "./nav-model";

function initials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

/**
 * The signed-in person: their time clock tablet photo when there is one, over
 * their initials, so a photo that fails to load (or a link that has expired
 * in a tab left open) steps aside and the initials show with nothing moving.
 */
export function Avatar({
  name,
  photo,
  size = 28,
  ring = false,
}: {
  name?: string | null;
  photo?: string | null;
  size?: number;
  /** A 2px card-colored ring, as the user card draws it against its well. */
  ring?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const showPhoto = !!photo && failed !== photo;
  return (
    <span
      className="relative inline-flex flex-none items-center justify-center overflow-hidden rounded-full"
      style={{
        width: size,
        height: size,
        background: "var(--wms-color-primary-100)",
        color: "var(--wms-color-primary-700)",
        fontFamily: "var(--font-sans)",
        fontWeight: 600,
        fontSize: Math.round(size * 0.375),
        lineHeight: 1,
        boxShadow: ring ? "0 0 0 2px var(--surface-card)" : undefined,
      }}
      title={name ?? undefined}
    >
      {initials(name)}
      {showPhoto && (
        // eslint-disable-next-line @next/next/no-img-element -- a signed S3 link, not an asset next/image can optimise
        <img
          src={photo}
          alt=""
          decoding="async"
          onError={() => setFailed(photo)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </span>
  );
}

interface SidebarProps {
  role: string;
  userName?: string | null;
  /** A signed link to the signed-in person's tablet photo, or null for initials. */
  userPhoto?: string | null;
  permissions?: string[];
  realRole?: string;
  viewAsRole?: string | null;
  canViewAs?: boolean;
  viewAsOptions?: { id: string; name: string }[];
  isInactive?: boolean;
  /** When set, the only pages the menu offers, whatever the permissions say. */
  onlyHrefs?: string[];
}

/** The floating white card both layouts sit in, from the Layout handoff. */
const SHELL_CARD: React.CSSProperties = {
  background: "var(--surface-card)",
  borderRadius: 16,
  boxShadow: "var(--ta-shell-shadow)",
};

const INACTIVE_NOTE = "Account inactive. View only.";

/** The CloudTime tile at 34px, lifted off the card by its own blue shadow. */
function Tile() {
  return (
    <span className="flex-none" style={{ borderRadius: 9, boxShadow: "var(--ta-tile-shadow)" }}>
      <BrandTile size={34} />
    </span>
  );
}

/** Tile, wordmark and attribution, sized as the handoff's sidebar draws them. */
function SidebarLockup() {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <Tile />
      <span className="flex min-w-0 flex-col gap-1">
        <span
          className="whitespace-nowrap"
          style={{ font: "var(--weight-bold) 20px/1 var(--font-sans)", letterSpacing: "-0.025em" }}
        >
          <span style={{ color: "var(--ta-wordmark-cloud)" }}>Cloud</span>
          <span style={{ color: "var(--ta-brand-orange)" }}>Time</span>
        </span>
        <span
          className="whitespace-nowrap uppercase"
          style={{
            font: "var(--weight-medium) 8px/1 var(--font-sans)",
            letterSpacing: "0.16em",
            color: "var(--text-tertiary)",
          }}
        >
          Powered by CloudX
        </span>
      </span>
    </span>
  );
}

/** The search field. It opens the ⌘K palette rather than being a second search box. */
function SearchField({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="ta-well-field flex h-[34px] w-full items-center gap-2 rounded-[10px] pl-2.5 pr-1.5"
      style={{ color: "var(--text-tertiary)", font: "var(--type-body2)" }}
    >
      <Search className="h-4 w-4 flex-none" />
      <span className="min-w-0 flex-1 truncate text-left">Search</span>
      <kbd
        className="inline-flex h-5 flex-none items-center rounded-md px-1.5"
        style={{
          background: "var(--surface-card)",
          boxShadow: "0 0 0 1px var(--ta-ring-strong), 0 1px 1px rgba(16, 24, 40, 0.05)",
          font: "var(--weight-medium) 11px/1 var(--font-sans)",
          color: "var(--text-secondary)",
        }}
      >
        ⌘K
      </kbd>
    </button>
  );
}

/** A count on a nav row, for the queues that carry one. */
function CountBadge({ n }: { n: number }) {
  return (
    <span
      className="inline-flex h-[18px] min-w-[18px] flex-none items-center justify-center rounded-full px-1.5"
      style={{
        font: "var(--type-caption2)",
        fontWeight: "var(--weight-semibold)",
        background: "var(--fill-accent)",
        color: "var(--text-on-accent)",
      }}
    >
      {n}
    </span>
  );
}

/**
 * One page in the menu, in either layout.
 *
 * <p>The open page gets the handoff's tint, a hairline ring and a small dot at
 * the end of the row. A row that carries a count shows the count instead of
 * the dot, so the number is never pushed off by a decoration.
 */
function NavRow({
  item,
  isActive,
  collapsed = false,
  withIcon = true,
}: {
  item: NavItem;
  isActive: boolean;
  collapsed?: boolean;
  withIcon?: boolean;
}) {
  return (
    <Link
      href={item.href}
      title={collapsed ? (item.badge ? `${item.label} (${item.badge})` : item.label) : undefined}
      data-active={isActive}
      aria-current={isActive ? "page" : undefined}
      className={`ta-hoverable relative flex h-[34px] flex-none items-center rounded-[10px] ${
        collapsed ? "justify-center px-0" : "gap-2.5 px-2.5"
      }`}
      style={{
        font: "500 14px/20px var(--font-sans)",
        fontWeight: isActive ? 600 : 500,
        background: isActive ? "var(--surface-info)" : "transparent",
        boxShadow: isActive ? "inset 0 0 0 1px var(--ta-nav-on-ring)" : "none",
        color: isActive ? "var(--text-accent)" : "var(--text-secondary)",
      }}
    >
      {withIcon && (
        <item.icon
          className="h-[18px] w-[18px] shrink-0"
          style={{ color: isActive ? "var(--icon-accent)" : "var(--icon-secondary)" }}
        />
      )}
      {collapsed ? (
        item.badge ? (
          <span
            aria-hidden="true"
            className="absolute right-3 top-1.5 h-2 w-2 rounded-full"
            style={{ background: "var(--fill-accent)", boxShadow: "0 0 0 2px var(--surface-card)" }}
          />
        ) : null
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          <LinkPendingSpinner />
          {item.badge ? (
            <CountBadge n={item.badge} />
          ) : isActive ? (
            <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: "var(--fill-accent)" }} />
          ) : null}
        </>
      )}
    </Link>
  );
}

/** The inactive account notice, in the handoff's warning tint. */
function InactiveNote({ compact }: { compact?: boolean }) {
  if (compact) {
    return (
      <div
        title={INACTIVE_NOTE}
        className="mx-2.5 mb-2 flex h-9 flex-none items-center justify-center rounded-[10px]"
        style={{ background: "var(--surface-warning)", color: "var(--icon-warning)" }}
      >
        <TriangleAlert className="h-4 w-4" />
      </div>
    );
  }
  return (
    <div
      className="mx-2.5 mb-2 flex-none rounded-[10px] px-2.5 py-2"
      style={{ background: "var(--surface-warning)", font: "var(--type-caption1)", color: "var(--text-warning)" }}
    >
      {INACTIVE_NOTE}
    </div>
  );
}

/**
 * The Rail layout: one card holding a 64px well of sections, and a panel
 * listing what is inside the one that is open.
 *
 * <p>Presentational on purpose. It reads no router and no storage, so the
 * layout can be rendered and looked at without a browser or a session, which
 * is the only way to check a navigation shell against the design.
 */
export function SidebarRail({
  sections,
  activeSectionId,
  activeSectionLabel,
  items,
  current,
  isInactive,
  onPickSection,
  onOpenSearch,
  identity,
}: {
  sections: { id: string; label: string; railLabel: string; icon: React.ElementType }[];
  activeSectionId?: string;
  activeSectionLabel: string;
  items: NavItem[];
  current: string | null;
  isInactive?: boolean;
  onPickSection: (id: string) => void;
  onOpenSearch: () => void;
  /** Avatar, view-as and sign out, drawn at the foot of the well. */
  identity: React.ReactNode;
}) {
  return (
    <aside className="flex w-[284px] flex-none p-1.5" style={SHELL_CARD}>
      {/* The well: one button per section. */}
      <div
        className="flex w-16 flex-none flex-col items-center gap-1 rounded-xl py-2"
        style={{ background: "var(--ta-well)" }}
      >
        <span className="mb-3">
          <Tile />
        </span>

        {sections.map((sec) => {
          const isActive = sec.id === activeSectionId;
          return (
            <button
              key={sec.id}
              type="button"
              onClick={() => onPickSection(sec.id)}
              title={sec.label}
              aria-current={isActive ? "true" : undefined}
              className="ta-rail-btn flex min-h-[50px] w-[52px] flex-none flex-col items-center justify-center gap-1 rounded-[10px]"
              style={{
                background: isActive ? "var(--surface-card)" : "transparent",
                boxShadow: isActive ? "var(--ta-raised)" : "none",
                color: isActive ? "var(--text-accent)" : "var(--icon-secondary)",
              }}
            >
              <sec.icon className="h-5 w-5" />
              <span className="whitespace-nowrap" style={{ font: "var(--weight-semibold) 10px/12px var(--font-sans)" }}>
                {sec.railLabel}
              </span>
            </button>
          );
        })}

        <div className="flex-1" />

        {identity}
      </div>

      {/* The panel: what is inside the section the well has open. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          className="flex h-[52px] flex-none items-center px-3.5"
          style={{
            font: "var(--weight-bold) 17px/22px var(--font-sans)",
            letterSpacing: "-0.015em",
            color: "var(--text-primary)",
          }}
        >
          <span className="min-w-0 truncate">{activeSectionLabel}</span>
        </div>

        <nav className="ta-scroll-hidden flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2">
          {items.map((item) => (
            <NavRow key={item.href} item={item} isActive={current === item.href} withIcon={false} />
          ))}
        </nav>

        {isInactive && <InactiveNote />}

        <div className="flex-none p-2">
          <SearchField onOpen={onOpenSearch} />
        </div>
      </div>
    </aside>
  );
}

export function Sidebar({
  userName,
  userPhoto,
  permissions,
  realRole,
  viewAsRole,
  canViewAs = false,
  viewAsOptions = [],
  isInactive = false,
  onlyHrefs,
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const collapsed = useSidebarCollapsed();
  const navMode = useNavMode();
  const [showRolePicker, setShowRolePicker] = useState(false);
  const [pinnedSection, setPinnedSection] = useState<{ id: string; path: string } | null>(null);
  const rolePickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (rolePickerRef.current && !rolePickerRef.current.contains(e.target as Node)) {
        setShowRolePicker(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSetViewAs(customRoleId: string) {
    startTransition(async () => {
      await setViewAsRole(customRoleId);
      setShowRolePicker(false);
      router.push("/dashboard");
      router.refresh();
    });
  }

  function handleClearViewAs() {
    startTransition(async () => {
      await clearViewAsRole();
      setShowRolePicker(false);
      router.push("/dashboard");
      router.refresh();
    });
  }

  function hasPermission(perm?: string | string[]) {
    if (!perm) return true;
    if (!permissions || permissions.length === 0) return false;
    if (Array.isArray(perm)) return perm.some((p) => permissions.includes(p));
    return permissions.includes(perm);
  }

  const sections = SECTIONS.map((section) => ({
    ...section,
    items: onlyHrefs
      ? section.items.filter((i) => onlyHrefs.includes(i.href))
      : isInactive
        ? section.items.filter((i) => INACTIVE_ALLOWED_HREFS.includes(i.href))
        : section.items.filter((i) => hasPermission(i.permission)),
  })).filter((section) => section.items.length > 0);

  const current = activeHref(
    pathname,
    sections.flatMap((s) => s.items.map((i) => i.href)),
  );

  const realRoleLabel = ROLE_LABEL[realRole ?? ""] ?? realRole;
  const togglePicker = () => canViewAs && setShowRolePicker((v) => !v);
  const signOutNow = () => signOut({ callbackUrl: "/login" });

  /**
   * The View as list. One list for every layout, placed by the caller, so it
   * can never quietly go missing from one of them.
   */
  const renderRolePicker = (placement: string) =>
    showRolePicker && (
      <div
        role="menu"
        className={`absolute z-50 w-[228px] rounded-xl p-1.5 ${placement}`}
        style={{ background: "var(--surface-card)", boxShadow: "var(--ta-menu-shadow)" }}
      >
        <div
          className="px-2 pb-1 pt-1.5 uppercase"
          style={{
            font: "var(--weight-semibold) 11px/14px var(--font-sans)",
            letterSpacing: "0.07em",
            color: "var(--text-tertiary)",
          }}
        >
          View as
        </div>
        {viewAsOptions.length === 0 && (
          <p className="px-2 py-2" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
            No roles available
          </p>
        )}
        {viewAsOptions.map((r) => {
          const on = r.name === viewAsRole;
          return (
            <button
              key={r.id}
              type="button"
              role="menuitem"
              data-active={on}
              disabled={isPending || on}
              onClick={() => handleSetViewAs(r.id)}
              className="ta-hoverable flex h-8 w-full items-center gap-2 rounded-lg px-2 disabled:cursor-default"
              style={{
                font: "var(--type-body2)",
                background: on ? "var(--surface-info)" : "transparent",
                color: on ? "var(--text-accent)" : "var(--text-secondary)",
                opacity: isPending && !on ? 0.5 : 1,
              }}
            >
              <span className="min-w-0 flex-1 truncate text-left">{r.name}</span>
              {on && <span style={{ font: "var(--type-caption1)" }}>Active</span>}
            </button>
          );
        })}
        {viewAsRole && (
          <>
            <div className="mx-1.5 my-1 h-px" style={{ background: "var(--stroke-divider)" }} />
            <button
              type="button"
              role="menuitem"
              disabled={isPending}
              onClick={handleClearViewAs}
              className="ta-hoverable flex h-8 w-full items-center gap-2 rounded-lg px-2 disabled:opacity-50"
              style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
            >
              <X className="h-3.5 w-3.5 flex-none" />
              <span className="min-w-0 truncate">Return to {realRoleLabel}</span>
            </button>
          </>
        )}
      </div>
    );

  /** A small eye in the warning tint, for layouts too narrow for the full chip. */
  const viewAsEye = viewAsRole && (
    <span
      title={`Viewing as ${viewAsRole}`}
      className="inline-flex h-5 w-7 flex-none items-center justify-center rounded-md"
      style={{ background: "var(--surface-warning)", color: "var(--icon-warning)" }}
    >
      <Eye className="h-3.5 w-3.5" />
    </span>
  );

  /**
   * The user card at the foot of the grouped layout: who you are, view-as,
   * sign out. Collapsed, it keeps the avatar and the way out, and the eye
   * says a view-as is on.
   */
  const renderFooter = (narrow: boolean) => (
    <div ref={rolePickerRef} className="relative flex-none p-2">
      {renderRolePicker("bottom-[calc(100%-2px)] left-2")}

      {narrow ? (
        <div
          className="flex flex-col items-center gap-1 rounded-xl py-1.5"
          style={{ background: "var(--ta-well)" }}
        >
          {viewAsEye}
          <button
            type="button"
            onClick={togglePicker}
            title={
              viewAsRole
                ? `${userName ?? "Signed in"}, viewing as ${viewAsRole}`
                : `${userName ?? "Signed in"} (${realRoleLabel})`
            }
            aria-haspopup={canViewAs ? "menu" : undefined}
            aria-expanded={canViewAs ? showRolePicker : undefined}
            className={`inline-flex rounded-full ${canViewAs ? "cursor-pointer" : "cursor-default"}`}
          >
            <Avatar name={userName} photo={userPhoto} size={32} />
          </button>
          <button
            type="button"
            onClick={signOutNow}
            title="Sign out"
            className="ta-signout inline-flex h-7 w-8 items-center justify-center rounded-lg"
            style={{ color: "var(--icon-secondary)" }}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div
          className="flex flex-col gap-1.5 rounded-xl p-1.5"
          style={{ background: "var(--ta-well)", boxShadow: "inset 0 0 0 1px var(--ta-well-ring)" }}
        >
          {viewAsRole && (
            <div
              className="flex h-[26px] items-center gap-1.5 rounded-lg pl-2 pr-1"
              style={{ background: "var(--surface-warning)", font: "var(--type-caption1)", color: "var(--text-warning)" }}
            >
              <Eye className="h-3.5 w-3.5 flex-none" />
              <span className="min-w-0 flex-1 truncate">Viewing as {viewAsRole}</span>
              <button
                type="button"
                onClick={handleClearViewAs}
                disabled={isPending}
                title={`Return to ${realRoleLabel}`}
                className="flex flex-none rounded-md p-[3px] disabled:opacity-50"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={togglePicker}
              title={canViewAs ? "View as another role" : undefined}
              aria-haspopup={canViewAs ? "menu" : undefined}
              aria-expanded={canViewAs ? showRolePicker : undefined}
              className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-[9px] p-1 text-left ${
                canViewAs ? "ta-lift cursor-pointer" : "cursor-default"
              }`}
            >
              <Avatar name={userName} photo={userPhoto} size={32} ring />
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate"
                  style={{ font: "var(--weight-semibold) 13px/18px var(--font-sans)", color: "var(--text-primary)" }}
                >
                  {userName ?? "Signed in"}
                </span>
                <span className="block truncate" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                  {realRoleLabel}
                </span>
              </span>
              {canViewAs && (
                <ChevronsUpDown className="h-3.5 w-3.5 flex-none" style={{ color: "var(--icon-secondary)" }} />
              )}
            </button>
            <button
              type="button"
              onClick={signOutNow}
              title="Sign out"
              className="ta-signout inline-flex h-8 w-8 flex-none items-center justify-center rounded-[9px]"
              style={{ color: "var(--icon-secondary)" }}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );

  /**
   * The foot of the rail's well: who you are, and the way out.
   *
   * <p>64px has no room for a name, so the avatar carries it in a title and
   * opens the same View as list, to the right, because a list inside a 64px
   * column is a list nobody can read.
   */
  const renderRailIdentity = () => (
    <div ref={rolePickerRef} className="relative flex flex-none flex-col items-center gap-1">
      {viewAsEye}
      <button
        type="button"
        onClick={togglePicker}
        title={
          viewAsRole
            ? `${userName ?? "Signed in"}, viewing as ${viewAsRole}`
            : `${userName ?? "Signed in"} (${realRoleLabel})`
        }
        aria-haspopup={canViewAs ? "menu" : undefined}
        aria-expanded={canViewAs ? showRolePicker : undefined}
        className={`inline-flex rounded-full ${canViewAs ? "cursor-pointer" : "cursor-default"}`}
      >
        <Avatar name={userName} photo={userPhoto} size={32} />
      </button>
      <button
        type="button"
        onClick={signOutNow}
        title="Sign out"
        className="ta-signout inline-flex h-[30px] w-8 items-center justify-center rounded-lg"
        style={{ color: "var(--icon-secondary)" }}
      >
        <LogOut className="h-4 w-4" />
      </button>
      {renderRolePicker("bottom-0 left-[calc(100%+10px)]")}
    </div>
  );

  if (navMode === "rail") {
    /**
     * Which section the panel is showing.
     *
     * <p>The route decides by default, so opening a record puts you in the
     * section it belongs to. Clicking a rail button pins a different one, but
     * only for as long as you stay on the page you clicked from: the moment
     * you navigate, the route is right again and the pin is stale. That is
     * why it remembers the path it was set on rather than needing an effect
     * to clear it.
     */
    const routeSection =
      sections.find((sec) => sec.items.some((i) => i.href === current)) ??
      sections.find((sec) => sec.prefixes?.some((pfx) => pathname.startsWith(pfx))) ??
      sections[0];
    const activeSection =
      (pinnedSection?.path === pathname
        ? sections.find((sec) => sec.id === pinnedSection.id)
        : undefined) ?? routeSection;

    return (
      <SidebarRail
        sections={sections}
        activeSectionId={activeSection?.id}
        activeSectionLabel={activeSection?.label ?? "Menu"}
        items={activeSection?.items ?? []}
        current={current}
        isInactive={isInactive}
        onPickSection={(id) => setPinnedSection({ id, path: pathname })}
        onOpenSearch={openCommandPalette}
        identity={renderRailIdentity()}
      />
    );
  }

  return (
    <aside
      className="relative flex flex-none flex-col transition-[width] duration-200 ease-in-out"
      style={{ ...SHELL_CARD, width: collapsed ? 64 : 244 }}
    >
      <div
        className={`flex h-16 flex-none items-center gap-2 ${collapsed ? "justify-center" : "pl-4 pr-3"}`}
      >
        {collapsed ? <Tile /> : <SidebarLockup />}
      </div>

      <div className="flex-none px-3 pb-2.5">
        {collapsed ? (
          <button
            type="button"
            onClick={openCommandPalette}
            title="Search ⌘K"
            className="ta-well-field grid h-9 w-full place-items-center rounded-[10px]"
            style={{ color: "var(--icon-secondary)" }}
          >
            <Search className="h-[18px] w-[18px]" />
          </button>
        ) : (
          <SearchField onOpen={openCommandPalette} />
        )}
      </div>

      <nav className="ta-scroll-hidden flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2.5 pb-3 pt-1.5">
        {sections.map((section) => (
          <div key={section.id} className="flex flex-col gap-0.5">
            {collapsed ? (
              <div
                aria-hidden="true"
                className="mx-[18px] mb-1.5 h-1 rounded"
                style={{ background: "var(--stroke-divider)" }}
              />
            ) : (
              <div
                className="truncate px-2.5 pb-1.5 pt-0.5 uppercase"
                style={{
                  font: "var(--weight-semibold) 11px/14px var(--font-sans)",
                  letterSpacing: "0.07em",
                  color: "var(--text-tertiary)",
                }}
              >
                {section.label}
              </div>
            )}

            {section.items.map((item) => (
              <NavRow key={item.href} item={item} isActive={current === item.href} collapsed={collapsed} />
            ))}
          </div>
        ))}
      </nav>

      {isInactive && <InactiveNote compact={collapsed} />}

      {renderFooter(collapsed)}
    </aside>
  );
}
