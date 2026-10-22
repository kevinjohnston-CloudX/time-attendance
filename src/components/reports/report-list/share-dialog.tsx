"use client";

import { useState, useTransition, useMemo } from "react";
import { Building2, Lock, Share2, Trash2, UserPlus, Users, type LucideIcon } from "lucide-react";
import { ReportWindow, WindowBlock, WindowCard, WindowChoices, WindowNote } from "../window/report-window";
import {
  Button,
  Input,
  Switch,
} from "@/components/ui";
import { shareReport, unshareReport, updateReport } from "@/actions/report.actions";
import phone from "../reports-phone.module.css";

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

type Visibility = "PRIVATE" | "SHARED" | "TENANT";

const VISIBILITY_CHOICES: { value: Visibility; icon: LucideIcon; title: string; body: string }[] = [
  { value: "PRIVATE", icon: Lock, title: "Only me", body: "Nobody else sees it. People named below keep their access." },
  { value: "SHARED", icon: Users, title: "People I pick", body: "Only the people named below can open it." },
  { value: "TENANT", icon: Building2, title: "Everyone who runs reports", body: "Everyone in the company who can use Reports can open it." },
];

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
    <ReportWindow
      icon={Share2}
      title="Share report"
      subtitle={reportName}
      size="md"
      onClose={onClose}
      hint={error ?? "Changes are saved as you make them."}
      hintTone={error ? "error" : undefined}
      actions={
        <Button hierarchy="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <WindowCard>
        <WindowBlock label="Who can open it">
          <WindowChoices
            name="report-visibility"
            value={visibility as Visibility}
            onChange={handleVisibilityChange}
            options={VISIBILITY_CHOICES}
          />
        </WindowBlock>
        <WindowBlock label="People">
          <div className="relative flex flex-col gap-1.5">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Add someone by name or email"
              aria-label="Add someone by name or email"
              leadingIcon={<UserPlus className="h-4 w-4" />}
            />
            {filteredUsers.length > 0 && (
              <ul
                className={`ta-modal absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto ${phone.suggest}`}
                style={{ borderRadius: "var(--radius-m)", listStyle: "none", margin: 0, padding: 4 }}
              >
                {filteredUsers.map((user) => (
                  <li key={user.id}>
                    <button
                      type="button"
                      onClick={() => handleShare(user.id)}
                      disabled={isPending}
                      className="flex w-full items-center gap-3 rounded-md bg-transparent px-3 py-2 text-left transition-colors hover:bg-[var(--ta-row-hover)]"
                      style={{ border: 0, cursor: "pointer" }}
                    >
                      <PersonText name={user.name} email={user.email} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {shares.length === 0 ? (
            <WindowNote>Nobody is named yet.</WindowNote>
          ) : (
            <ul className="flex flex-col" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {shares.map((share, i) => (
                <li
                  key={share.id}
                  className="flex flex-wrap items-center gap-3 py-2.5"
                  style={{ borderTop: i === 0 ? undefined : "1px solid var(--stroke-divider)" }}
                >
                  <PersonText name={share.user.name} email={share.user.email} />
                  {/* A switch: whether somebody can pass a shared report on is a setting. */}
                  <Switch
                    size="sm"
                    checked={share.canEdit}
                    disabled={isPending}
                    onChange={(next) => handleToggleEdit(share.user.id, next)}
                    label={
                      <span
                        style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
                        title="They can share it with others and change its email schedule. Only you can edit the report."
                      >
                        Can share and schedule
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
          )}
        </WindowBlock>
      </WindowCard>
    </ReportWindow>
  );
}

function PersonText({ name, email }: { name: string | null; email: string | null }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate" style={{ font: "var(--type-body1)", fontWeight: "var(--weight-medium)", color: "var(--text-primary)" }}>
        {name ?? "Unnamed"}
      </span>
      {email && (
        <span className="truncate" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
          {email}
        </span>
      )}
    </span>
  );
}
