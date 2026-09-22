"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Folder, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { fieldCls } from "@/components/ui/form-classes";
import {
  createFolder,
  renameFolder,
  deleteFolder,
} from "@/actions/report.actions";

/**
 * The folder rail beside the reports list.
 *
 * <p>The design's reports screen is a flat list with no rail, but folders here
 * are a real owned hierarchy with create, rename and delete server actions
 * behind them, and this is the only screen that reaches any of the three.
 * Dropping the rail to match the drawing would have deleted three working
 * features, so it stays — restyled onto the kit, at the width the admin hub
 * uses for its own rail.
 *
 * <p>Picking a folder is a link, not a click handler. Every other filter on
 * this screen lives in the query string so a narrowed list can be reloaded and
 * sent to somebody; a folder that only existed in React state would be the one
 * filter that vanished on a refresh, and it is the one that most changes what
 * you are looking at.
 */

export interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
  /** The list URL with this folder applied — built on the server. */
  href: string;
  reportCount: number;
  children: { id: string; name: string }[];
}

export function FolderTree({
  folders,
  selectedFolderId,
  allHref,
  totalReports,
}: {
  folders: FolderNode[];
  selectedFolderId: string | null;
  /** The same list with no folder applied. */
  allHref: string;
  totalReports: number;
}) {
  const router = useRouter();

  const [isCreating, setIsCreating] = useState(false);
  const [creatingParentId, setCreatingParentId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const createInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isCreating && createInputRef.current) {
      createInputRef.current.focus();
    }
  }, [isCreating]);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const rootFolders = folders.filter((f) => f.parentId === null);

  function toggleExpand(folderId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  function handleStartCreate(parentId: string | null = null) {
    setIsCreating(true);
    setCreatingParentId(parentId);
    setNewFolderName("");
    if (parentId) {
      setExpandedIds((prev) => new Set(prev).add(parentId));
    }
  }

  function handleCreateSubmit() {
    const name = newFolderName.trim();
    if (!name) {
      setIsCreating(false);
      return;
    }
    startTransition(async () => {
      await createFolder(
        creatingParentId ? { name, parentId: creatingParentId } : { name }
      );
      setIsCreating(false);
      setNewFolderName("");
      setCreatingParentId(null);
    });
  }

  function handleStartRename(folder: { id: string; name: string }) {
    setRenamingId(folder.id);
    setRenameValue(folder.name);
  }

  function handleRenameSubmit() {
    if (!renamingId) return;
    const name = renameValue.trim();
    if (!name) {
      setRenamingId(null);
      return;
    }
    startTransition(async () => {
      await renameFolder({ id: renamingId!, data: { name } });
      setRenamingId(null);
      setRenameValue("");
    });
  }

  function handleDelete(folderId: string) {
    startTransition(async () => {
      await deleteFolder({ id: folderId });
      setDeletingId(null);
      // The folder is gone but the URL still names it, which would leave the
      // list filtered to a folder that no longer exists — an empty list with
      // no visible reason. Go back to everything.
      if (selectedFolderId === folderId) router.replace(allHref);
    });
  }

  function renderInlineInput(
    value: string,
    onChange: (v: string) => void,
    onSubmit: () => void,
    onCancel: () => void,
    ref: React.RefObject<HTMLInputElement | null>,
    ariaLabel: string
  ) {
    return (
      <input
        ref={ref}
        type="text"
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit();
          if (e.key === "Escape") onCancel();
        }}
        onBlur={onSubmit}
        className={fieldCls}
        disabled={isPending}
      />
    );
  }

  function renderFolder(folder: FolderNode, depth = 0) {
    const isSelected = selectedFolderId === folder.id;
    const isExpanded = expandedIds.has(folder.id);
    const hasChildren = folder.children.length > 0;
    const isRenaming = renamingId === folder.id;
    const isDeleting = deletingId === folder.id;

    return (
      <div key={folder.id}>
        <div
          className="group flex items-center gap-1 rounded-md py-1 pr-1.5"
          style={{
            paddingLeft: depth * 14 + 6,
            background: isSelected ? "var(--surface-info)" : undefined,
          }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggleExpand(folder.id)}
              aria-expanded={isExpanded}
              aria-label={`${isExpanded ? "Collapse" : "Expand"} ${folder.name}`}
              className="flex-none rounded p-0.5"
              style={{ color: "var(--icon-tertiary)", cursor: "pointer" }}
            >
              <ChevronRight
                className="h-3.5 w-3.5 transition-transform"
                style={{ transform: isExpanded ? "rotate(90deg)" : undefined }}
              />
            </button>
          ) : (
            <span className="h-[18px] w-[18px] flex-none" />
          )}

          <Folder className="h-4 w-4 flex-none" style={{ color: "var(--icon-tertiary)" }} />

          {isRenaming ? (
            <div className="min-w-0 flex-1">
              {renderInlineInput(
                renameValue,
                setRenameValue,
                handleRenameSubmit,
                () => setRenamingId(null),
                renameInputRef,
                `Rename ${folder.name}`
              )}
            </div>
          ) : isDeleting ? (
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <span
                className="min-w-0 flex-1 truncate"
                style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
              >
                Delete &ldquo;{folder.name}&rdquo;?
              </span>
              <Button
                size="sm"
                hierarchy="tertiary"
                tone="error"
                disabled={isPending}
                onClick={() => handleDelete(folder.id)}
              >
                Yes
              </Button>
              <Button size="sm" hierarchy="tertiary" onClick={() => setDeletingId(null)}>
                No
              </Button>
            </div>
          ) : (
            <>
              {/* Double-click still starts a rename, as it always has. It now
                  navigates as well, but only to the folder being renamed, so
                  the shortcut costs nothing to keep. */}
              <Link
                href={folder.href}
                scroll={false}
                onDoubleClick={() => handleStartRename(folder)}
                className="min-w-0 flex-1 truncate"
                style={{
                  font: "var(--type-body1)",
                  fontWeight: isSelected ? "var(--weight-semibold)" : undefined,
                  color: isSelected ? "var(--text-accent)" : "var(--text-primary)",
                  textDecoration: "none",
                }}
              >
                {folder.name}
              </Link>
              <span
                className="tabular flex-none"
                style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}
              >
                {folder.reportCount}
              </span>
              {/* Rename and delete appear on hover, but focus has to reveal
                  them too or they are unreachable from the keyboard. */}
              <div className="flex flex-none items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <Button
                  size="sm"
                  hierarchy="tertiary"
                  iconOnly
                  title={`Rename ${folder.name}`}
                  aria-label={`Rename ${folder.name}`}
                  onClick={() => handleStartRename(folder)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  hierarchy="tertiary"
                  tone="error"
                  iconOnly
                  title={`Delete ${folder.name}`}
                  aria-label={`Delete ${folder.name}`}
                  onClick={() => setDeletingId(folder.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </>
          )}
        </div>

        {isExpanded && hasChildren && (
          <div>
            {folder.children.map((child) => {
              const childFolder = folders.find((f) => f.id === child.id);
              return childFolder ? renderFolder(childFolder, depth + 1) : null;
            })}
          </div>
        )}

        {isExpanded && isCreating && creatingParentId === folder.id && (
          <div
            className="flex items-center gap-1.5 py-1 pr-1.5"
            style={{ paddingLeft: (depth + 1) * 14 + 6 }}
          >
            <Folder className="h-4 w-4 flex-none" style={{ color: "var(--icon-tertiary)" }} />
            <div className="min-w-0 flex-1">
              {renderInlineInput(
                newFolderName,
                setNewFolderName,
                handleCreateSubmit,
                () => setIsCreating(false),
                createInputRef,
                `New folder in ${folder.name}`
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <Card
      title="Folders"
      padding={8}
      actions={
        <Button
          size="sm"
          hierarchy="tertiary"
          iconOnly
          title="New folder"
          aria-label="New folder"
          onClick={() => handleStartCreate(null)}
        >
          <FolderPlus className="h-4 w-4" />
        </Button>
      }
    >
      <nav className="flex flex-col gap-0.5">
        <div
          className="flex items-center gap-1.5 rounded-md py-1 pl-1.5 pr-1.5"
          style={{ background: selectedFolderId === null ? "var(--surface-info)" : undefined }}
        >
          <Folder className="h-4 w-4 flex-none" style={{ color: "var(--icon-tertiary)" }} />
          <Link
            href={allHref}
            scroll={false}
            className="min-w-0 flex-1 truncate"
            style={{
              font: "var(--type-body1)",
              fontWeight: selectedFolderId === null ? "var(--weight-semibold)" : undefined,
              color: selectedFolderId === null ? "var(--text-accent)" : "var(--text-primary)",
              textDecoration: "none",
            }}
          >
            All reports
          </Link>
          <span
            className="tabular flex-none"
            style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}
          >
            {totalReports}
          </span>
        </div>

        {rootFolders.map((folder) => renderFolder(folder))}

        {isCreating && creatingParentId === null && (
          <div className="flex items-center gap-1.5 py-1 pl-1.5 pr-1.5">
            <Folder className="h-4 w-4 flex-none" style={{ color: "var(--icon-tertiary)" }} />
            <div className="min-w-0 flex-1">
              {renderInlineInput(
                newFolderName,
                setNewFolderName,
                handleCreateSubmit,
                () => setIsCreating(false),
                createInputRef,
                "New folder name"
              )}
            </div>
          </div>
        )}

        {folders.length === 0 && !isCreating && (
          <p
            className="px-1.5 py-1"
            style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-tertiary)" }}
          >
            No folders yet.
          </p>
        )}
      </nav>
    </Card>
  );
}
