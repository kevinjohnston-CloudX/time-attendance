"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import {
  Folder,
  FolderPlus,
  Pencil,
  Trash2,
  ChevronRight,
} from "lucide-react";
import {
  createFolder,
  renameFolder,
  deleteFolder,
} from "@/actions/report.actions";

interface FolderTreeProps {
  folders: {
    id: string;
    name: string;
    parentId: string | null;
    _count: { reports: number };
    children: { id: string; name: string }[];
  }[];
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
}

export function FolderTree({
  folders,
  selectedFolderId,
  onSelectFolder,
}: FolderTreeProps) {
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

  const totalReports = folders.reduce(
    (sum, f) => sum + f._count.reports,
    0
  );

  const rootFolders = folders.filter((f) => f.parentId === null);

  function toggleExpand(folderId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
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
      if (selectedFolderId === folderId) {
        onSelectFolder(null);
      }
    });
  }

  function renderInlineInput(
    value: string,
    onChange: (v: string) => void,
    onSubmit: () => void,
    onCancel: () => void,
    ref: React.RefObject<HTMLInputElement | null>
  ) {
    return (
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit();
          if (e.key === "Escape") onCancel();
        }}
        onBlur={onSubmit}
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        disabled={isPending}
      />
    );
  }

  function renderFolder(
    folder: FolderTreeProps["folders"][number],
    depth: number = 0
  ) {
    const isSelected = selectedFolderId === folder.id;
    const isExpanded = expandedIds.has(folder.id);
    const hasChildren = folder.children.length > 0;
    const isRenaming = renamingId === folder.id;
    const isDeleting = deletingId === folder.id;

    return (
      <div key={folder.id}>
        <div
          className={`group flex items-center gap-1 rounded-lg px-3 py-2 text-sm transition-colors ${
            isSelected
              ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white"
              : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          }`}
          style={{ paddingLeft: `${depth * 16 + 12}px` }}
        >
          {hasChildren ? (
            <button
              onClick={() => toggleExpand(folder.id)}
              className="flex-shrink-0 p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              <ChevronRight
                className={`h-3.5 w-3.5 transition-transform ${
                  isExpanded ? "rotate-90" : ""
                }`}
              />
            </button>
          ) : (
            <span className="w-4.5 flex-shrink-0" />
          )}

          <Folder className="h-4 w-4 flex-shrink-0 text-zinc-400" />

          {isRenaming ? (
            <div className="min-w-0 flex-1">
              {renderInlineInput(
                renameValue,
                setRenameValue,
                handleRenameSubmit,
                () => setRenamingId(null),
                renameInputRef
              )}
            </div>
          ) : isDeleting ? (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                Delete &ldquo;{folder.name}&rdquo;?
              </span>
              <button
                onClick={() => handleDelete(folder.id)}
                disabled={isPending}
                className="rounded px-1.5 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                Yes
              </button>
              <button
                onClick={() => setDeletingId(null)}
                className="rounded px-1.5 py-0.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                No
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={() => onSelectFolder(folder.id)}
                onDoubleClick={() => handleStartRename(folder)}
                className="min-w-0 flex-1 truncate text-left"
              >
                {folder.name}
              </button>
              <span className="flex-shrink-0 text-xs text-zinc-400">
                {folder._count.reports}
              </span>
              <div className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStartRename(folder);
                  }}
                  className="rounded p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                  title="Rename folder"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeletingId(folder.id);
                  }}
                  className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                  title="Delete folder"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </>
          )}
        </div>

        {isExpanded && hasChildren && (
          <div>
            {folder.children.map((child) => {
              const childFolder = folders.find((f) => f.id === child.id);
              if (!childFolder) return null;
              return renderFolder(childFolder, depth + 1);
            })}
          </div>
        )}

        {isExpanded &&
          isCreating &&
          creatingParentId === folder.id && (
            <div
              className="flex items-center gap-1 px-3 py-1"
              style={{ paddingLeft: `${(depth + 1) * 16 + 12}px` }}
            >
              <Folder className="h-4 w-4 flex-shrink-0 text-zinc-400" />
              <div className="min-w-0 flex-1">
                {renderInlineInput(
                  newFolderName,
                  setNewFolderName,
                  handleCreateSubmit,
                  () => setIsCreating(false),
                  createInputRef
                )}
              </div>
            </div>
          )}
      </div>
    );
  }

  return (
    <nav className="flex flex-col gap-1">
      <div className="flex items-center justify-between px-3 py-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Folders
        </h2>
        <button
          onClick={() => handleStartCreate(null)}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          title="New folder"
        >
          <FolderPlus className="h-4 w-4" />
        </button>
      </div>

      {/* All Reports */}
      <button
        onClick={() => onSelectFolder(null)}
        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
          selectedFolderId === null
            ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white"
            : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        }`}
      >
        <Folder className="h-4 w-4 text-zinc-400" />
        <span className="flex-1 text-left">All Reports</span>
        <span className="text-xs text-zinc-400">{totalReports}</span>
      </button>

      {/* Root folders */}
      {rootFolders.map((folder) => renderFolder(folder))}

      {/* Inline create at root level */}
      {isCreating && creatingParentId === null && (
        <div className="flex items-center gap-2 px-3 py-1">
          <Folder className="h-4 w-4 flex-shrink-0 text-zinc-400" />
          <div className="min-w-0 flex-1">
            {renderInlineInput(
              newFolderName,
              setNewFolderName,
              handleCreateSubmit,
              () => setIsCreating(false),
              createInputRef
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
