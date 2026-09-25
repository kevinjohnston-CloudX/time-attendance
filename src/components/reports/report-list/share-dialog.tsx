"use client";

import { useState, useTransition, useMemo } from "react";
import { Trash2, UserPlus, X } from "lucide-react";
import {
  Button,
  Input,
  SegmentedControl,
  Switch,
} from "@/components/ui";
import { shareReport, unshareReport, updateReport } from "@/actions/report.actions";

interface ShareDialogProps {
  reportId: string;
  reportName: string;
  visibility: string;
  shares: {
    id: string;
    user: { id: string; name: string | null; email: string | null };
    canEdit: boolean;
  }[];
  tenantUsers: { id: string; name: string | null; email: string | null }[];
  onClose: () => void;
}

/**
 * Who else can open a report.
 *
 * <p>Visibility is a SegmentedControl because the three settings are one
 * choice, not three switches — the previous three tiles could each look
 * "pressed" and nothing said that picking one un-picked the others.
 *
 * <p>The named-people list stays underneath whatever visibility says, because
 * it does not disappear when visibility changes: a report set back to Private
 * still carries its shares, and hiding them would make it look as though they
 * had been revoked.
 */

const VISIBILITY_ITEMS = [
  { value: "PRIVATE", label: "Private" },
  { value: "SHARED", label: "Shared" },
  { value: "TENANT", label: "Everyone" },
];

const VISIBILITY_HINT: Record<string, string> = {
  PRIVATE: "Only you can open it. People named below keep their access.",
  SHARED: "Only the people named below can open it.",
  TENANT: "Everyone in your company who can use Reports can open it.",
};

export function ShareDialog({
  reportId,
  reportName,
  visibility: initialVisibility,
  shares: initialShares,
  tenantUsers,
  onClose,
}: ShareDialogProps) {
  const [visibility, setVisibility] = useState(initialVisibility);
  const [shares, setShares] = useState(initialShares);
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();

  const sharedUserIds = useMemo(
    () => new Set(shares.map((s) => s.user.id)),
    [shares],
  );

  const filteredUsers = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    return tenantUsers.filter(
      (u) =>
        !sharedUserIds.has(u.id) &&
        ((u.name && u.name.toLowerCase().includes(q)) ||
          (u.email && u.email.toLowerCase().includes(q))),
    );
  }, [search, tenantUsers, sharedUserIds]);

  // Every change waits for the server's answer before the list moves: the
  // actions answer with a result rather than throwing, and the list used to
  // show a person as added when the server had refused.
  const [error, setError] = useState<string | null>(null);
  const refused = () => setError("That change was not saved. You may not have permission to share this report.");

  function handleVisibilityChange(value: string) {
    const before = visibility;
    setVisibility(value);
    setError(null);
    startTransition(async () => {
      const res = await updateReport({ id: reportId, data: { visibility: value } });
      if (!res.success) {
        setVisibility(before);
        refused();
      }
    });
  }

  function handleShare(userId: string) {
    const user = tenantUsers.find((u) => u.id === userId);
    if (!user) return;
    setError(null);

    startTransition(async () => {
      const res = await shareReport({ reportId, data: { userId, canEdit: false } });
      if (!res.success) return refused();
      setShares((prev) => [...prev, { id: res.data.id, user, canEdit: false }]);
    });
    setSearch("");
  }

  function handleToggleEdit(userId: string, canEdit: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await shareReport({ reportId, data: { userId, canEdit } });
      if (!res.success) return refused();
      setShares((prev) => prev.map((s) => (s.user.id === userId ? { ...s, canEdit } : s)));
    });
  }

  function handleUnshare(userId: string) {
    setError(null);
    startTransition(async () => {
      const res = await unshareReport({ reportId, userId });
      if (!res.success) return refused();
      setShares((prev) => prev.filter((s) => s.user.id !== userId));
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Share ${reportName}`}
        className="ta-modal w-full max-w-lg overflow-hidden"
        style={{ borderRadius: "var(--radius-l)" }}
      >
        <header
          className="flex items-center gap-3 px-5 py-3.5"
          style={{ borderBottom: "1px solid var(--stroke-divider)" }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 style={{ margin: 0, font: "var(--type-h4)", color: "var(--text-primary)" }}>
              Share Report
            </h2>
            <p
              className="truncate"
              style={{ margin: 0, font: "var(--type-subtitle)", color: "var(--text-secondary)" }}
            >
              {reportName}
            </p>
          </div>
          <Button hierarchy="tertiary" iconOnly onClick={onClose} aria-label="Close" title="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex flex-col gap-5 px-5 py-4">
          <div className="flex flex-col gap-1.5">
            {error && (
              <p role="alert" style={{ margin: "0 0 4px", font: "var(--type-body2)", color: "var(--text-error)" }}>
                {error}
              </p>
            )}
            <span className="wms-overline">Who can open it</span>
            <SegmentedControl
              items={VISIBILITY_ITEMS}
              value={visibility}
              onChange={handleVisibilityChange}
              fullWidth
              ariaLabel="Who can open this report"
            />
            <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-secondary)" }}>
              {VISIBILITY_HINT[visibility] ?? ""}
            </p>
          </div>

          <div className="relative flex flex-col gap-1.5">
            <Input
              label="Share with"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or email"
              leadingIcon={<UserPlus className="h-4 w-4" />}
            />
            {filteredUsers.length > 0 && (
              <ul
                className="ta-modal absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto"
                style={{ borderRadius: "var(--radius-m)", listStyle: "none", margin: 0, padding: 4 }}
              >
                {filteredUsers.map((user) => (
                  <li key={user.id}>
                    <button
                      type="button"
                      onClick={() => handleShare(user.id)}
                      disabled={isPending}
                      // The hover fill is a utility and the background is not
                      // an inline style: .ta-row only lifts rows inside a
                      // tbody, and an inline background would beat the
                      // utility anyway — between them these rows had no hover
                      // at all, on the one list whose whole purpose is being
                      // clicked.
                      className="flex w-full items-center gap-3 rounded-md bg-transparent px-3 py-2 text-left transition-colors hover:bg-[var(--ta-row-hover)]"
                      style={{ border: 0, cursor: "pointer" }}
                    >
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span
                          className="truncate"
                          style={{
                            font: "var(--type-body1)",
                            fontWeight: "var(--weight-medium)",
                            color: "var(--text-primary)",
                          }}
                        >
                          {user.name ?? "Unnamed"}
                        </span>
                        {user.email && (
                          <span
                            className="truncate"
                            style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}
                          >
                            {user.email}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {shares.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="wms-overline">Shared with</span>
              <ul
                className="flex flex-col"
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  border: "1px solid var(--stroke-divider)",
                  borderRadius: "var(--radius-m)",
                }}
              >
                {shares.map((share, i) => (
                  <li
                    key={share.id}
                    className="flex flex-wrap items-center gap-3 px-3 py-2.5"
                    style={{ borderTop: i === 0 ? undefined : "1px solid var(--stroke-divider)" }}
                  >
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span
                        className="truncate"
                        style={{
                          font: "var(--type-body1)",
                          fontWeight: "var(--weight-medium)",
                          color: "var(--text-primary)",
                        }}
                      >
                        {share.user.name ?? "Unnamed"}
                      </span>
                      {share.user.email && (
                        <span
                          className="truncate"
                          style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}
                        >
                          {share.user.email}
                        </span>
                      )}
                    </div>

                    {/* A switch, not a pill that toggles on click: whether
                        somebody can change a shared report is the kind of thing
                        that should look like a setting, not like a label. */}
                    <Switch
                      size="sm"
                      checked={share.canEdit}
                      disabled={isPending}
                      onChange={(next) => handleToggleEdit(share.user.id, next)}
                      label={
                        <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                          Can edit
                        </span>
                      }
                    />

                    <Button
                      hierarchy="tertiary"
                      tone="error"
                      size="sm"
                      iconOnly
                      disabled={isPending}
                      onClick={() => handleUnshare(share.user.id)}
                      title={`Remove ${share.user.name ?? share.user.email ?? "this person"}`}
                      aria-label={`Remove ${share.user.name ?? share.user.email ?? "this person"}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <footer
          className="flex justify-end px-5 py-3"
          style={{ borderTop: "1px solid var(--stroke-divider)" }}
        >
          <Button hierarchy="primary" onClick={onClose}>
            Done
          </Button>
        </footer>
      </div>
    </div>
  );
}
