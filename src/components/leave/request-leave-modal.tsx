"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { RequestLeaveForm } from "./request-leave-form";
import type { ShiftInfo } from "./leave-day-picker";
import { Button } from "@/components/ui";

interface Props {
  leaveTypes: { id: string; name: string }[];
  shift: ShiftInfo | null;
}

/**
 * File a request without leaving the page you are on.
 *
 * <p>Not used by My Leave any more — the design sends that screen's primary
 * action to /leave/request, which is a full document with a back action. This
 * stays because it is the same form and the same two server calls, so any
 * screen that wants to file a request inline can mount it.
 */
export function RequestLeaveModal({ leaveTypes, shift }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function handleSuccess() {
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
        Request Leave
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Request leave"
            className="ta-modal relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl p-6"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 style={{ margin: 0, font: "var(--type-h3)", color: "var(--text-primary)" }}>
                Request Leave
              </h3>
              <Button hierarchy="tertiary" iconOnly aria-label="Close" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <RequestLeaveForm
              leaveTypes={leaveTypes}
              shift={shift}
              layout="modal"
              onSuccess={handleSuccess}
            />
          </div>
        </div>
      )}
    </>
  );
}
