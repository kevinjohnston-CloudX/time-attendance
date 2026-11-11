"use client";

import { useId, useState, type ReactNode, type RefObject } from "react";
import { FileUp } from "lucide-react";
import styles from "./file-well.module.css";

/**
 * Choosing a file in a window: a well with an icon, the file's name (or the
 * prompt) and Browse. The whole well opens the picker, and a file dropped on
 * it counts the same as one picked.
 */
export function FileWell({
  label,
  required = false,
  accept,
  fileName,
  detail,
  prompt = "Choose a file",
  icon,
  inputRef,
  onFile,
}: {
  label: string;
  required?: boolean;
  /** The picker's file types, as the input's accept takes them. */
  accept: string;
  /** The chosen file's name, or nothing yet. */
  fileName: string | null;
  /** One quiet line under the name: its size, or what is accepted. */
  detail: ReactNode;
  prompt?: string;
  icon?: ReactNode;
  /** To clear the picker from outside, after a file has been used. */
  inputRef?: RefObject<HTMLInputElement | null>;
  onFile: (file: File) => void;
}) {
  const id = useId();
  const [dragging, setDragging] = useState(false);
  return (
    <div className="flex w-full flex-col gap-1.5">
      <span className="wms-label" id={`${id}-label`}>
        {label}
        {required && (
          <span aria-hidden="true" style={{ color: "var(--text-error)", marginLeft: 3 }}>
            *
          </span>
        )}
      </span>
      <label
        className={styles.well}
        data-dragging={dragging || undefined}
        data-filled={fileName ? true : undefined}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const dropped = e.dataTransfer.files?.[0];
          if (dropped) onFile(dropped);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          aria-labelledby={`${id}-label`}
          accept={accept}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />
        <span className={styles.icon} aria-hidden="true">
          {icon ?? <FileUp />}
        </span>
        <span className={styles.text}>
          <span className={styles.title}>{fileName ?? prompt}</span>
          <span className={styles.detail}>{detail}</span>
        </span>
        <span className={styles.action}>{fileName ? "Change" : "Browse"}</span>
      </label>
    </div>
  );
}

/** A file's size the way people say it. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
