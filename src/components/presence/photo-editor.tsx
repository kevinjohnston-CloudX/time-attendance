"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Camera, ImageUp, X } from "lucide-react";
import { Button } from "@/components/ui";
import { updateEmployeePhoto } from "@/actions/presence.actions";
import { initialsOf } from "./presence-meta";
import styles from "./on-site.module.css";

/**
 * Update photo: a new picture for a person, from a file or the camera,
 * framed and saved over the photo the time clock tablets took.
 *
 * <p>The frame is portrait, 3 by 4, because every place a face is drawn
 * crops to portrait; a landscape tablet photo loses its sides anyway. The
 * picture is framed and shrunk here, in the browser, so the server only
 * checks and files a small JPEG and never works on pixels.
 *
 * <p>Nothing is saved until Save photo. Closing, Escape or Cancel leave the
 * person's photo as it was. Escape is caught before the panel underneath
 * hears it, so it closes this and leaves the panel open.
 */

/** The frame on screen, and the file it becomes. */
const FRAME_W = 240;
const FRAME_H = 320;
const OUT_W = 900;
const OUT_H = 1200;
const QUALITY = 0.86;
const MAX_ZOOM = 3;
/** Anything a phone or camera writes fits; the server gets about 200 KB. */
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

type Mode = "current" | "camera" | "frame";

const SAVE_ERRORS: Record<string, string> = {
  FORBIDDEN: "You do not have permission to update photos.",
  UNAUTHENTICATED: "Your session has ended. Sign in again to save the photo.",
  NOT_FOUND: "This employee could not be found.",
  PHOTO_SIZE: "That photo is too large to save.",
  PHOTO_TYPE: "That file could not be saved as a photo.",
  NO_BADGE: "This employee has no badge to file a photo under.",
  PHOTOS_OFF: "Photos are not set up here.",
};

export function PhotoEditor({
  siteId,
  employeeId,
  name,
  detail,
  currentSrc,
  onClose,
  onSaved,
}: {
  siteId: string;
  employeeId: string;
  name: string;
  detail: string;
  currentSrc: string | null | undefined;
  onClose: () => void;
  /** The new photo's link, to draw at once everywhere on the page. */
  onSaved: (photoUrl: string | null) => void;
}) {
  const [mode, setMode] = useState<Mode>("current");
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [currentFailed, setCurrentFailed] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const objectUrl = useRef<string | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(
    null,
  );
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Escape closes this, not the panel; focus comes in and goes back out.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, []);

  // The camera and the picked file are let go of however the dialog closes.
  useEffect(
    () => () => {
      stopCamera();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [stopCamera],
  );

  /* ── The picture in the frame ── */

  const base = image
    ? Math.max(FRAME_W / image.naturalWidth, FRAME_H / image.naturalHeight)
    : 1;
  const drawnW = image ? image.naturalWidth * base * zoom : 0;
  const drawnH = image ? image.naturalHeight * base * zoom : 0;

  // The picture always covers the frame, so no edge of it ever shows.
  const clamp = useCallback(
    (o: { x: number; y: number }, z = zoom) => {
      if (!image) return o;
      const w = image.naturalWidth * base * z;
      const h = image.naturalHeight * base * z;
      const mx = Math.max(0, (w - FRAME_W) / 2);
      const my = Math.max(0, (h - FRAME_H) / 2);
      return {
        x: Math.min(mx, Math.max(-mx, o.x)),
        y: Math.min(my, Math.max(-my, o.y)),
      };
    },
    [image, base, zoom],
  );

  const take = useCallback(async (src: string, revoke: boolean) => {
    const img = new Image();
    img.src = src;
    try {
      await img.decode();
    } catch {
      if (revoke) URL.revokeObjectURL(src);
      setError("That file could not be opened as a photo.");
      return;
    }
    if (objectUrl.current && objectUrl.current !== src)
      URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = revoke ? src : null;
    setImage(img);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setError(null);
    setMode("frame");
  }, []);

  const pickFile = useCallback(
    (file: File | null | undefined) => {
      if (!file) return;
      if (!file.type.startsWith("image/"))
        return setError("Choose a photo file, such as a JPG or PNG.");
      if (file.size > MAX_INPUT_BYTES)
        return setError("That photo is too large. Choose one under 25 MB.");
      stopCamera();
      void take(URL.createObjectURL(file), true);
    },
    [stopCamera, take],
  );

  /* ── The camera ── */

  const openCamera = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "This browser cannot use a camera here. Choose a photo file instead.",
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setMode("camera");
    } catch (e) {
      const denied =
        e instanceof DOMException &&
        (e.name === "NotAllowedError" || e.name === "SecurityError");
      setError(
        denied
          ? "Camera access was blocked. Allow it in the browser's address bar, or choose a photo file."
          : "No camera was found. Choose a photo file instead.",
      );
    }
  }, []);

  // The stream is attached once the video element is on screen.
  useEffect(() => {
    if (mode !== "camera" || !videoRef.current || !streamRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    void videoRef.current.play().catch(() => {});
  }, [mode]);

  const snap = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")?.drawImage(v, 0, 0);
    stopCamera();
    void take(c.toDataURL("image/jpeg", 0.95), false);
  }, [stopCamera, take]);

  const cancelCamera = useCallback(() => {
    stopCamera();
    setMode(image ? "frame" : "current");
  }, [stopCamera, image]);

  /* ── Moving and zooming ── */

  const onPointerDown = (e: ReactPointerEvent) => {
    if (mode !== "frame") return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setOffset(clamp({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onFrameKey = (e: ReactKeyboardEvent) => {
    if (mode !== "frame") return;
    const step = e.shiftKey ? 20 : 5;
    const move = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    }[e.key];
    if (!move) return;
    e.preventDefault();
    setOffset((o) => clamp({ x: o.x + move[0], y: o.y + move[1] }));
  };
  const changeZoom = (z: number) => {
    setZoom(z);
    setOffset((o) => clamp(o, z));
  };

  /* ── Saving ── */

  const save = async () => {
    if (!image || saving) return;
    setSaving(true);
    setError(null);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = OUT_W;
      canvas.height = OUT_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("CANVAS");
      const k = OUT_W / FRAME_W;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, OUT_W, OUT_H);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(
        image,
        (FRAME_W / 2 + offset.x - drawnW / 2) * k,
        (FRAME_H / 2 + offset.y - drawnH / 2) * k,
        drawnW * k,
        drawnH * k,
      );
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, "image/jpeg", QUALITY),
      );
      if (!blob) throw new Error("CANVAS");

      const form = new FormData();
      form.set("siteId", siteId);
      form.set("employeeId", employeeId);
      form.set("photo", blob, "photo.jpg");
      const res = await updateEmployeePhoto(form);
      if (!res.success) {
        setError(
          SAVE_ERRORS[res.error] ?? "The photo could not be saved. Try again.",
        );
        setSaving(false);
        return;
      }
      onSaved(res.data.photoUrl);
    } catch {
      setError("The photo could not be saved. Try again.");
      setSaving(false);
    }
  };

  const showCurrent = mode === "current" && currentSrc && !currentFailed;

  return (
    <div className={styles.peScrim} onClick={saving ? undefined : onClose}>
      <div
        ref={dialogRef}
        className={styles.peDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pe-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.peHead}>
          <div className="flex min-w-0 flex-col">
            <h2 id="pe-title" className={styles.peTitle}>
              Update photo
            </h2>
            <span className={styles.peSub} title={`${name} · ${detail}`}>
              {[name, detail].filter(Boolean).join(" · ")}
            </span>
          </div>
          <Button
            hierarchy="tertiary"
            size="sm"
            iconOnly
            aria-label="Close"
            onClick={onClose}
            disabled={saving}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className={styles.peBody}>
          <div
            className={styles.peFrame}
            data-mode={mode}
            data-over={dragOver ? "true" : undefined}
            style={{ width: FRAME_W, height: FRAME_H }}
            tabIndex={mode === "frame" ? 0 : -1}
            role={mode === "frame" ? "application" : undefined}
            aria-label={
              mode === "frame"
                ? "Photo framing. Drag or use the arrow keys to move the photo."
                : undefined
            }
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onFrameKey}
            onDragOver={(e) => {
              if (mode === "camera") return;
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              pickFile(e.dataTransfer.files?.[0]);
            }}
          >
            {mode === "current" && (
              <>
                <span
                  className={styles.initials}
                  style={{ fontSize: 44 }}
                  aria-hidden="true"
                >
                  {initialsOf(name)}
                </span>
                {showCurrent && (
                  // eslint-disable-next-line @next/next/no-img-element -- a signed S3 link
                  <img
                    src={currentSrc}
                    alt={`Current photo of ${name}`}
                    className={styles.peCurrent}
                    onError={() => setCurrentFailed(true)}
                  />
                )}
                <span className={styles.peFrameTag}>
                  {showCurrent ? "Current photo" : "No photo yet"}
                </span>
              </>
            )}
            {mode === "camera" && (
              <video
                ref={videoRef}
                className={styles.peVideo}
                playsInline
                muted
                aria-label="Camera"
              />
            )}
            {mode === "frame" && image && (
              // eslint-disable-next-line @next/next/no-img-element -- a local picture being framed
              <img
                src={image.src}
                alt=""
                draggable={false}
                className={styles.pePicture}
                style={{
                  width: drawnW,
                  height: drawnH,
                  left: FRAME_W / 2 + offset.x - drawnW / 2,
                  top: FRAME_H / 2 + offset.y - drawnH / 2,
                }}
              />
            )}
            {mode === "frame" && (
              <span className={styles.peGuide} aria-hidden="true" />
            )}
          </div>

          {mode === "frame" && (
            <label className={styles.peZoom}>
              <span>Zoom</span>
              <input
                type="range"
                min={1}
                max={MAX_ZOOM}
                step={0.01}
                value={zoom}
                onChange={(e) => changeZoom(Number(e.target.value))}
                aria-label="Zoom"
              />
            </label>
          )}
          <p className={styles.peHint}>
            {mode === "camera"
              ? "Face the camera, then take the photo."
              : mode === "frame"
                ? "Drag to position the face in the frame."
                : "Choose a photo or use the camera. You can frame it before saving."}
          </p>

          <div className={styles.peSources}>
            {mode === "camera" ? (
              <>
                <Button
                  hierarchy="primary"
                  leadingIcon={<Camera className="h-4 w-4" />}
                  onClick={snap}
                  data-autofocus=""
                >
                  Take photo
                </Button>
                <Button hierarchy="secondary" onClick={cancelCamera}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  hierarchy="secondary"
                  leadingIcon={<ImageUp className="h-4 w-4" />}
                  onClick={() => fileRef.current?.click()}
                  disabled={saving}
                  data-autofocus=""
                >
                  {mode === "frame" ? "Choose another" : "Choose photo"}
                </Button>
                <Button
                  hierarchy="secondary"
                  leadingIcon={<Camera className="h-4 w-4" />}
                  onClick={openCamera}
                  disabled={saving}
                >
                  Use camera
                </Button>
              </>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                pickFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>

          {error && (
            <p className={styles.peError} role="alert">
              {error}
            </p>
          )}
        </div>

        <div className={styles.peFoot}>
          <span className={styles.peNote}>The photo it replaces is kept.</span>
          <div className="flex items-center gap-2">
            <Button hierarchy="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              hierarchy="primary"
              onClick={save}
              disabled={mode !== "frame" || !image || saving}
            >
              {saving ? "Saving" : "Save photo"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
