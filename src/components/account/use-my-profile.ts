"use client";

import { useCallback, useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { useRouter } from "@/components/layout/navigation-progress";
import { loadMyProfile } from "@/actions/profile.actions";
import { changeOwnPassword } from "@/actions/password.actions";
import type { MyProfile } from "@/lib/account/my-profile.service";

/**
 * What My profile shows and does, shared by the computer window and the
 * phone screens, so the two can differ in shape and never in behaviour.
 */

export const NOT_ON_FILE = "Not on file";

export function initials(name: string | null): string {
  const parts = (name ?? "").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

/** A calendar date (YYYY-MM-DD) in words, read the same in every time zone. */
export function dateWords(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function signInMethod(p: MyProfile): string {
  return p.hasPassword ? "Email and password" : "Google account";
}

/** The person's own profile, loaded once when the window or screen opens. */
export function useMyProfile() {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchProfile = useCallback(
    () =>
      loadMyProfile()
        .then((r) => (r.success ? setProfile(r.data) : setLoadError(r.message)))
        .catch(() => setLoadError("Your profile could not be opened. Try again.")),
    [],
  );

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  const retry = () => {
    setLoadError(null);
    void fetchProfile();
  };

  return { profile, loadError, retry };
}

/**
 * Changing your own password: the current one, then the new one twice. On
 * success every sign in has already ended on the server, so this one leaves
 * at once for the sign in page, which says why.
 */
export function usePasswordChange() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setFailure(null);
  };

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (saving) return;
    setFailure(null);
    if (next !== confirm) {
      setFailure("The new passwords do not match.");
      return;
    }
    setSaving(true);
    const result = await changeOwnPassword(current, next, confirm).catch(() => null);
    if (!result?.success) {
      setSaving(false);
      setFailure(result?.message ?? "The password could not be changed. Try again.");
      return;
    }
    await signOut({ redirect: false });
    router.push("/login?changed=1");
  }

  return {
    current,
    setCurrent,
    next,
    setNext,
    confirm,
    setConfirm,
    saving,
    failure,
    filled: !!(current && next && confirm),
    submit,
    reset,
  };
}

export const PASSWORD_RULES = "At least 8 characters, with an uppercase letter, a number and a symbol.";
export const PASSWORD_AFTER = "You will be signed out on every device, then sign in again with the new password.";
