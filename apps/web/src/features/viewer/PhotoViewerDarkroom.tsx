import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { ChevronLeft, ChevronRight, Info, MoreVertical, X } from "lucide-react";
import { formatCapturedAt } from "../../lib/capturedAtFormat.js";
import { capturedAtSourceLabel } from "../../lib/capturedAtSource.js";
import type { AlbumMutations } from "../album/albumMutations.js";
import { useAlbumMutationsSnapshot } from "../album/useAlbumMutations.js";
import { ALBUM_BACKGROUND_ROOT_ID } from "../shell/albumBackgroundRoot.js";
import type { PhotoViewer } from "./photoViewer.js";
import { usePhotoViewerSnapshot } from "./usePhotoViewer.js";
import { CapturedAtEditorDialog } from "../chronology/CapturedAtEditorDialog.js";
import { createHttpCapturedAtEditorPort } from "../chronology/capturedAtEditorPort.js";

interface PhotoViewerDarkroomProps {
  viewer: PhotoViewer;
  mutations: AlbumMutations;
  mode: "contextual" | "direct";
  onClose: () => void;
}

/** The tracer Viewer's Darkroom presentation (implementation doc "Photo Viewer"). */
export function PhotoViewerDarkroom({ viewer, mutations, mode, onClose }: PhotoViewerDarkroomProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const snapshot = usePhotoViewerSnapshot(viewer);
  const mutationsSnapshot = useAlbumMutationsSnapshot(mutations);
  const [infoOpen, setInfoOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorHistoryBackSignal, setEditorHistoryBackSignal] = useState(0);
  const [chronologyAnnouncement, setChronologyAnnouncement] = useState<string>();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const editorHistoryReadyRef = useRef(false);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    let backgroundRoot: HTMLElement | null = null;
    if (mode === "contextual") {
      backgroundRoot = document.getElementById(ALBUM_BACKGROUND_ROOT_ID);
      backgroundRoot?.setAttribute("inert", "");
      backgroundRoot?.setAttribute("aria-hidden", "true");
    }

    return () => {
      backgroundRoot?.removeAttribute("inert");
      backgroundRoot?.removeAttribute("aria-hidden");
      const target = previouslyFocusedRef.current;
      if (target && document.contains(target)) {
        target.focus({ preventScroll: true });
      }
    };
    // Runs once per mount; `mode` and `onClose` are fixed for the component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (editorOpen) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (moreOpen) {
          setMoreOpen(false);
          return;
        }
        onClose();
      } else if (event.key === "ArrowLeft") {
        viewer.intents.showPrevious();
      } else if (event.key === "ArrowRight") {
        viewer.intents.showNext();
      } else if (event.key === "Tab") {
        trapTab(event, dialogRef.current);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, viewer, moreOpen, editorOpen]);

  useEffect(() => {
    const viewerElement = dialogRef.current;
    if (!viewerElement || !editorOpen) {
      return;
    }
    viewerElement.setAttribute("inert", "");
    viewerElement.setAttribute("aria-hidden", "true");
    return () => {
      viewerElement.removeAttribute("inert");
      viewerElement.removeAttribute("aria-hidden");
    };
  }, [editorOpen]);

  useEffect(() => {
    const isEditorEntry = Boolean((location.state as { capturedAtEditor?: boolean } | null)?.capturedAtEditor);
    if (editorOpen && isEditorEntry) {
      editorHistoryReadyRef.current = true;
    } else if (editorOpen && editorHistoryReadyRef.current) {
      setEditorHistoryBackSignal((signal) => signal + 1);
    }
  }, [editorOpen, location.key, location.state]);

  const bootstrap = snapshot.bootstrap;

  const advanceOrClose = (): void => {
    if (bootstrap?.olderPhotoId !== undefined) {
      viewer.intents.showNext();
    } else if (bootstrap?.newerPhotoId !== undefined) {
      viewer.intents.showPrevious();
    } else {
      onClose();
    }
  };

  const handleArchiveOrRestore = (): void => {
    if (!bootstrap) {
      return;
    }
    setMoreOpen(false);
    mutations.intents.setMembership({ photoId: bootstrap.photoId, collection: bootstrap.collection });
    advanceOrClose();
  };

  const handleDownloadOriginal = (): void => {
    if (!bootstrap) {
      return;
    }
    mutations.intents.downloadOriginal({ photoId: bootstrap.photoId, fileName: bootstrap.fileName });
  };

  const openEditor = (): void => {
    setMoreOpen(false);
    navigate(location.pathname, { state: { ...(location.state ?? {}), capturedAtEditor: true } });
    setEditorOpen(true);
  };

  const closeEditor = (fromHistory = false): void => {
    setEditorOpen(false);
    editorHistoryReadyRef.current = false;
    if (!fromHistory) {
      navigate(-1);
    }
    window.setTimeout(() => moreButtonRef.current?.focus(), 0);
  };

  const downloadInFlight = bootstrap ? mutationsSnapshot.downloadsInFlight.has(bootstrap.photoId) : false;

  return (
    <div
      aria-label={bootstrap?.fileName ?? "Photo"}
      aria-modal={mode === "contextual" ? "true" : undefined}
      className="fixed inset-0 z-50 flex flex-col bg-stone-950 text-white"
      ref={dialogRef}
      role={mode === "contextual" ? "dialog" : undefined}
    >
      <header className="flex items-center justify-between gap-3 p-3">
        <button
          aria-label="Close"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white"
          onClick={onClose}
          ref={closeButtonRef}
          type="button"
        >
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2 text-sm">
          {bootstrap ? <span>{formatCapturedAt(bootstrap.chronology.active.capturedAt, "compact")}</span> : null}
          {snapshot.sequencePosition?.total !== undefined ? (
            <span className="text-white/70">
              {snapshot.sequencePosition.index + 1} of {snapshot.sequencePosition.total}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <button
            aria-expanded={infoOpen}
            aria-label="Photo information"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white"
            onClick={() => setInfoOpen((open) => !open)}
            type="button"
          >
            <Info aria-hidden="true" className="h-5 w-5" />
          </button>
          {bootstrap ? (
            <div className="relative">
              <button
                aria-expanded={moreOpen}
                aria-haspopup="menu"
                aria-label="More"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white"
                onClick={() => setMoreOpen((open) => !open)}
                ref={moreButtonRef}
                type="button"
              >
                <MoreVertical aria-hidden="true" className="h-5 w-5" />
              </button>
              {moreOpen ? (
                <div
                  className="absolute right-0 top-full z-10 mt-1 min-w-48 rounded-md border border-white/10 bg-stone-900 py-1 text-sm shadow-lg"
                  role="menu"
                >
                  <button
                    className="block w-full px-4 py-2 text-left hover:bg-white/10 focus:outline-none focus:bg-white/10"
                    onClick={openEditor}
                    role="menuitem"
                    type="button"
                  >
                    Adjust date and time
                  </button>
                  <button
                    className="block w-full px-4 py-2 text-left hover:bg-white/10 focus:outline-none focus:bg-white/10"
                    onClick={handleArchiveOrRestore}
                    role="menuitem"
                    type="button"
                  >
                    {bootstrap.collection === "active" ? "Archive photo" : "Restore to timeline"}
                  </button>
                  <button
                    className="block w-full px-4 py-2 text-left hover:bg-white/10 focus:outline-none focus:bg-white/10 disabled:opacity-50"
                    disabled={downloadInFlight}
                    onClick={handleDownloadOriginal}
                    role="menuitem"
                    type="button"
                  >
                    {downloadInFlight ? "Preparing download…" : "Download original"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {snapshot.collectionChanged ? (
          <CollectionChangedNotice
            currentCollection={snapshot.collectionChanged.currentCollection}
            onReturn={onClose}
            onSwitch={() => viewer.intents.switchToCurrentCollection()}
          />
        ) : snapshot.loadError ? (
          <p className="flex flex-col items-center gap-3 text-center">
            Couldn&apos;t load this photo.
            <button className="underline" onClick={() => viewer.intents.retry()} type="button">
              Retry
            </button>
          </p>
        ) : snapshot.isLoading || !bootstrap ? (
          <p role="status">Loading photo…</p>
        ) : (
          <img
            alt={bootstrap.fileName}
            className="max-h-full max-w-full object-contain"
            onLoad={() => viewer.intents.notifyDisplayDecoded()}
            src={bootstrap.displayAccess.url}
          />
        )}

        {bootstrap?.newerPhotoId !== undefined ? (
          <NavButton ariaLabel="Previous" icon="left" onClick={() => viewer.intents.showPrevious()} />
        ) : null}
        {bootstrap?.olderPhotoId !== undefined ? (
          <NavButton ariaLabel="Next" icon="right" onClick={() => viewer.intents.showNext()} />
        ) : null}
      </div>

      {infoOpen && bootstrap ? <InfoPanel bootstrap={bootstrap} /> : null}
      {editorOpen && bootstrap ? (
        <CapturedAtEditorDialog
          chronology={bootstrap.chronology}
          collection={bootstrap.collection}
          historyBackSignal={editorHistoryBackSignal}
          onDismiss={closeEditor}
          onSuccess={(result) => {
            mutations.intents.chronologyChanged({ photoId: bootstrap.photoId, collection: bootstrap.collection });
            setChronologyAnnouncement(`${result.kind === "adjust" ? "Date and time adjusted" : "Date and time reverted"}. ${formatCapturedAt(result.capturedAt, "accessible")}. ${capturedAtSourceLabel(result.source)}.`);
            viewer.intents.refresh();
          }}
          photoId={bootstrap.photoId}
          port={createHttpCapturedAtEditorPort()}
          restoreHistoryEntry={() => navigate(location.pathname, { state: { ...(location.state ?? {}), capturedAtEditor: true } })}
        />
      ) : null}
      {chronologyAnnouncement ? <p aria-atomic="true" aria-live="polite" className="sr-only" role="status">{chronologyAnnouncement}</p> : null}
    </div>
  );
}

function NavButton({
  ariaLabel,
  icon,
  onClick,
}: {
  ariaLabel: string;
  icon: "left" | "right";
  onClick: () => void;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className={`absolute top-1/2 -translate-y-1/2 inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/40 hover:bg-black/60 focus:outline-none focus:ring-2 focus:ring-white ${
        icon === "left" ? "left-3" : "right-3"
      }`}
      onClick={onClick}
      type="button"
    >
      {icon === "left" ? (
        <ChevronLeft aria-hidden="true" className="h-6 w-6" />
      ) : (
        <ChevronRight aria-hidden="true" className="h-6 w-6" />
      )}
    </button>
  );
}

function CollectionChangedNotice({
  currentCollection,
  onReturn,
  onSwitch,
}: {
  currentCollection: "active" | "archived";
  onReturn: () => void;
  onSwitch: () => void;
}) {
  return (
    <div className="flex max-w-sm flex-col items-center gap-3 text-center">
      <p>
        This photo moved to {currentCollection === "archived" ? "Archive" : "Timeline"} since you opened it.
      </p>
      <div className="flex gap-2">
        <button
          className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-stone-950"
          onClick={onSwitch}
          type="button"
        >
          View in {currentCollection === "archived" ? "Archive" : "Timeline"}
        </button>
        <button className="rounded-md border border-white/40 px-3 py-2 text-sm font-semibold" onClick={onReturn} type="button">
          Return
        </button>
      </div>
    </div>
  );
}

function InfoPanel({ bootstrap }: { bootstrap: NonNullable<ReturnType<typeof usePhotoViewerSnapshot>["bootstrap"]> }) {
  return (
    <aside className="max-h-[40vh] overflow-y-auto border-t border-white/10 bg-stone-900 p-4 text-sm">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
        <dt className="font-semibold text-white/70">Captured</dt>
        <dd>{formatCapturedAt(bootstrap.chronology.active.capturedAt, "detail")}</dd>
        <dt className="font-semibold text-white/70">Source</dt>
        <dd>{capturedAtSourceLabel(bootstrap.chronology.active.source)}</dd>
        {bootstrap.metadata?.cameraMake ? (
          <>
            <dt className="font-semibold text-white/70">Camera</dt>
            <dd>{[bootstrap.metadata.cameraMake, bootstrap.metadata.cameraModel].filter(Boolean).join(" ")}</dd>
          </>
        ) : null}
        {bootstrap.metadata?.lensModel ? (
          <>
            <dt className="font-semibold text-white/70">Lens</dt>
            <dd>{bootstrap.metadata.lensModel}</dd>
          </>
        ) : null}
        <dt className="font-semibold text-white/70">Dimensions</dt>
        <dd>
          {bootstrap.displayDimensions.width} x {bootstrap.displayDimensions.height}
        </dd>
        <dt className="font-semibold text-white/70">Format</dt>
        <dd className="uppercase">{bootstrap.format}</dd>
        <dt className="font-semibold text-white/70">Size</dt>
        <dd>{formatBytes(bootstrap.fileSizeBytes)}</dd>
        <dt className="font-semibold text-white/70">File name</dt>
        <dd className="break-words">{bootstrap.fileName}</dd>
        {bootstrap.metadata?.location ? (
          <>
            <dt className="font-semibold text-white/70">Location</dt>
            <dd>
              {bootstrap.metadata.location.latitude.toFixed(5)}, {bootstrap.metadata.location.longitude.toFixed(5)}
            </dd>
          </>
        ) : null}
      </dl>
    </aside>
  );
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const trapTab = (event: KeyboardEvent, container: HTMLElement | null): void => {
  if (!container) {
    return;
  }
  const focusable = container.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  if (focusable.length === 0) {
    return;
  }
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
};
