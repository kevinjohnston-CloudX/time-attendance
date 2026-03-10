"use client";

import { useState, useTransition, useMemo } from "react";
import { X, UserPlus, Trash2, Shield, Globe, Lock } from "lucide-react";
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

const VISIBILITY_OPTIONS = [
  { value: "PRIVATE", label: "Private", icon: Lock, description: "Only you can access" },
  { value: "SHARED", label: "Shared", icon: Shield, description: "Shared with specific users" },
  { value: "TENANT", label: "Everyone", icon: Globe, description: "All users in your organization" },
] as const;

const inputClass =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";

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

  function handleVisibilityChange(value: string) {
    setVisibility(value);
    startTransition(async () => {
      await updateReport({ id: reportId, data: { visibility: value } });
    });
  }

  function handleShare(userId: string) {
    const user = tenantUsers.find((u) => u.id === userId);
    if (!user) return;

    startTransition(async () => {
      const result = await shareReport({
        reportId,
        data: { userId, canEdit: false },
      });
      if (result) {
        setShares((prev) => [
          ...prev,
          {
            id: typeof result === "object" && "id" in result ? (result as { id: string }).id : userId,
            user,
            canEdit: false,
          },
        ]);
      }
    });
    setSearch("");
  }

  function handleToggleEdit(userId: string, canEdit: boolean) {
    startTransition(async () => {
      await shareReport({ reportId, data: { userId, canEdit } });
      setShares((prev) =>
        prev.map((s) => (s.user.id === userId ? { ...s, canEdit } : s)),
      );
    });
  }

  function handleUnshare(userId: string) {
    startTransition(async () => {
      await unshareReport({ reportId, userId });
      setShares((prev) => prev.filter((s) => s.user.id !== userId));
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mx-4 w-full max-w-lg rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-700">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
              Share Report
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {reportName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          {/* Visibility */}
          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Visibility
            </label>
            <div className="grid grid-cols-3 gap-2">
              {VISIBILITY_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = visibility === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => handleVisibilityChange(opt.value)}
                    disabled={isPending}
                    className={`flex flex-col items-center gap-1.5 rounded-lg border px-3 py-2.5 text-center transition-colors ${
                      active
                        ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-300 dark:bg-zinc-300 dark:text-zinc-900"
                        : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:bg-zinc-750"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="text-xs font-medium">{opt.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-zinc-400 dark:text-zinc-500">
              {VISIBILITY_OPTIONS.find((o) => o.value === visibility)?.description}
            </p>
          </div>

          {/* Search & Add Users */}
          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Share with users
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="Search by name or email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={`${inputClass} w-full`}
              />
              {filteredUsers.length > 0 && (
                <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                  {filteredUsers.map((user) => (
                    <li key={user.id}>
                      <button
                        onClick={() => handleShare(user.id)}
                        disabled={isPending}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-700"
                      >
                        <UserPlus className="h-4 w-4 shrink-0 text-zinc-400" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-zinc-900 dark:text-white">
                            {user.name ?? "Unnamed"}
                          </p>
                          {user.email && (
                            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                              {user.email}
                            </p>
                          )}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Current Shares */}
          {shares.length > 0 && (
            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Shared with
              </label>
              <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
                {shares.map((share) => (
                  <li
                    key={share.id}
                    className="flex items-center gap-3 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-900 dark:text-white">
                        {share.user.name ?? "Unnamed"}
                      </p>
                      {share.user.email && (
                        <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                          {share.user.email}
                        </p>
                      )}
                    </div>

                    <button
                      onClick={() =>
                        handleToggleEdit(share.user.id, !share.canEdit)
                      }
                      disabled={isPending}
                      title={share.canEdit ? "Can edit — click to make view-only" : "View only — click to allow editing"}
                      className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                        share.canEdit
                          ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 dark:hover:bg-emerald-900/50"
                          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                      }`}
                    >
                      {share.canEdit ? "Can edit" : "View only"}
                    </button>

                    <button
                      onClick={() => handleUnshare(share.user.id)}
                      disabled={isPending}
                      className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                      title="Remove access"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-zinc-200 px-5 py-3 dark:border-zinc-700">
          <button
            onClick={onClose}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
