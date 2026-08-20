import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { ChevronLeft, ChevronRight, Heart, Info, MoreVertical, X } from "lucide-react";
import { formatCapturedAt } from "../../lib/capturedAtFormat.js";
import { trapTab } from "../../lib/focusTrap.js";
import { capturedAtSourceLabel } from "../../lib/capturedAtSource.js";
import { daysRemainingInTrash, isRetentionUrgent, retentionBadgeLabel } from "../../lib/trashRetention.js";
import type { AlbumMutations } from "../album/albumMutations.js";
import { useAlbumMutationsSnapshot } from "../album/useAlbumMutations.js";
import { ALBUM_BACKGROUND_ROOT_ID } from "../shell/albumBackgroundRoot.js";
import type { PhotoViewer } from "./photoViewer.js";
import { usePhotoViewerSnapshot } from "./usePhotoViewer.js";
import { CapturedAtEditorDialog } from "../chronology/CapturedAtEditorDialog.js";
import { createHttpCapturedAtEditorPort } from "../chronology/capturedAtEditorPort.js";
import { ViewerMediaStage } from "./ViewerMediaStage.js";
import { PermanentDeletionDialog } from "../album/PermanentDeletionDialog.js";

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
  const [permanentDeletionOpen, setPermanentDeletionOpen] = useState(false);
  const [editorHistoryBackSignal, setEditorHistoryBackSignal] = useState(0);
  const [chronologyAnnouncement, setChronologyAnnouncement] = useState<string>();
  const [chromeVisible, setChromeVisible] = useState(true);
  const [gestureActive, setGestureActive] = useState(false);
  const [activityTick, setActivityTick] = useState(0);
  const [photoAnnouncement, setPhotoAnnouncement] = useState<string>();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const editorHistoryReadyRef = useRef(false);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const announcedPhotoRef = useRef<string | undefined>(undefined);
  const idleTimerRef = useRef<number | undefined>(undefined);
  const bootstrap = snapshot.bootstrap;

  const revealChrome = () => { setChromeVisible(true); setActivityTick((tick) => tick + 1); };
  useEffect(() => {
    window.clearTimeout(idleTimerRef.current);
    if (!gestureActive && !infoOpen && !moreOpen && !editorOpen && chromeVisible) {
      idleTimerRef.current = window.setTimeout(() => setChromeVisible(false), 3_000);
    }
    return () => window.clearTimeout(idleTimerRef.current);
  }, [activityTick, bootstrap?.photoId, chromeVisible, editorOpen, gestureActive, infoOpen, moreOpen]);

  useEffect(() => {
    if (!bootstrap) return;
    if (announcedPhotoRef.current !== undefined && announcedPhotoRef.current !== bootstrap.photoId) {
      setPhotoAnnouncement(`${bootstrap.fileName}. ${formatCapturedAt(bootstrap.chronology.active.capturedAt, "accessible")}${snapshot.sequencePosition?.total !== undefined ? `. ${snapshot.sequencePosition.index + 1} of ${snapshot.sequencePosition.total}` : ""}`);
    }
    announcedPhotoRef.current = bootstrap.photoId;
  }, [bootstrap, snapshot.sequencePosition]);

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
      if (editorOpen || permanentDeletionOpen) {
        return;
      }
      revealChrome();
      if (event.key === "Escape") {
        event.preventDefault();
        if (moreOpen) {
          setMoreOpen(false);
          return;
        }
        if (infoOpen) { setInfoOpen(false); return; }
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
  }, [onClose, viewer, moreOpen, infoOpen, editorOpen, permanentDeletionOpen]);

  useEffect(() => {
    if (!moreOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !moreButtonRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [moreOpen]);

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

  const advanceOrClose = (): void => {
    if (bootstrap?.olderPhotoId !== undefined) {
      viewer.intents.showNext();
    } else if (bootstrap?.newerPhotoId !== undefined) {
      viewer.intents.showPrevious();
    } else {
      onClose();
    }
  };

  const handleTrashOrRestore = (): void => {
    if (!bootstrap) {
      return;
    }
    setMoreOpen(false);
    // `setMembership`'s `collection` is the membership collection the Photo is leaving, which
    // `bootstrap.trashed` gives even when the Viewer Sequence itself is scoped to `favourite`.
    mutations.intents.setMembership({ photoId: bootstrap.photoId, collection: bootstrap.trashed ? "trashed" : "active" });
    advanceOrClose();
  };

  const handleDownloadOriginal = (): void => {
    if (!bootstrap) {
      return;
    }
    setMoreOpen(false);
    mutations.intents.downloadOriginal({ photoId: bootstrap.photoId, fileName: bootstrap.fileName });
  };

  const openPermanentDeletion = (): void => {
    setMoreOpen(false);
    setPermanentDeletionOpen(true);
  };

  const confirmPermanentDeletion = (): void => {
    if (!bootstrap) return;
    setPermanentDeletionOpen(false);
    mutations.intents.permanentlyDeletePhoto(bootstrap.photoId);
    advanceOrClose();
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
  const favourite = bootstrap
    ? (mutationsSnapshot.favouriteOverrides.get(bootstrap.photoId) ?? bootstrap.favourite)
    : false;

  const handleToggleFavourite = (): void => {
    if (!bootstrap) {
      return;
    }
    mutations.intents.setFavourite({ photoId: bootstrap.photoId, favourite: !favourite, sourceCollection: bootstrap.collection });
  };

  return (
    <div
      aria-label={bootstrap?.fileName ?? "Photo"}
      aria-modal={mode === "contextual" ? "true" : undefined}
      className="photo-darkroom fixed inset-0 z-50 flex flex-col bg-darkroom text-white"
      ref={dialogRef}
      // A direct/standalone load (refresh or shared link) has no background page underneath --
      // this is the page's whole content, so it needs a landmark (axe "region") rather than the
      // dialog role reserved for the contextual overlay atop a Timeline/Trash background.
      role={mode === "contextual" ? "dialog" : "main"}
      onFocusCapture={revealChrome}
    >
      {/* A plain div, not <header>: nested inside the dialog it would register as a second
          "banner" landmark alongside the shell's own <header> (axe landmark-unique). */}
      <div className={`flex items-center justify-between gap-3 p-3 transition-opacity ${chromeVisible ? "" : "pointer-events-none opacity-0"}`} onFocus={revealChrome}>
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
            aria-controls="photo-information"
            aria-expanded={infoOpen}
            aria-label="Photo information"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white"
            onClick={() => setInfoOpen((open) => !open)}
            type="button"
          >
            <Info aria-hidden="true" className="h-5 w-5" />
          </button>
          {bootstrap ? (
            <button
              aria-label={favourite ? "Unfavourite" : "Favourite"}
              aria-pressed={favourite}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white"
              onClick={handleToggleFavourite}
              type="button"
            >
              <Heart aria-hidden="true" className={`h-5 w-5 ${favourite ? "fill-danger text-danger" : ""}`} />
            </button>
          ) : null}
          {bootstrap ? (
            <div className="relative">
              <button
                aria-expanded={moreOpen}
                aria-haspopup="menu"
                aria-label="More"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white"
                onClick={() => setMoreOpen((open) => !open)}
                onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") { event.preventDefault(); setMoreOpen(true); } }}
                ref={moreButtonRef}
                type="button"
              >
                <MoreVertical aria-hidden="true" className="h-5 w-5" />
              </button>
              {moreOpen ? (
                <div
                  className="absolute right-0 top-full z-10 mt-1 min-w-48 rounded-md border border-white/10 bg-darkroom-elevated py-1 text-sm shadow-lg"
                  onKeyDown={(event) => {
                    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
                    const index = items.indexOf(document.activeElement as HTMLButtonElement);
                    if (event.key === "Escape") { event.preventDefault(); setMoreOpen(false); moreButtonRef.current?.focus(); }
                    else if (event.key === "Tab") setMoreOpen(false);
                    else if (event.key === "Home" || event.key === "End" || event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; items[next]?.focus(); }
                  }}
                  ref={menuRef}
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
                    onClick={handleTrashOrRestore}
                    role="menuitem"
                    type="button"
                  >
                    {bootstrap.trashed ? "Restore to timeline" : "Trash photo"}
                  </button>
                  {bootstrap.trashed ? (
                    <button
                      className="block w-full px-4 py-2 text-left text-danger hover:bg-white/10 focus:outline-none focus:bg-white/10"
                      onClick={openPermanentDeletion}
                      role="menuitem"
                      type="button"
                    >
                      Delete permanently
                    </button>
                  ) : null}
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
      </div>

      {snapshot.collectionChanged ? (
          <CollectionChangedNotice
            currentCollection={snapshot.collectionChanged.currentCollection}
            onReturn={onClose}
            onSwitch={() => viewer.intents.switchToCurrentCollection()}
            requestedFavourites={snapshot.collectionChanged.requestedCollection === "favourite"}
          />
        ) : <ViewerMediaStage bootstrap={bootstrap} chromeVisible={chromeVisible} isLoading={snapshot.isLoading} loadError={snapshot.loadError} onActivity={revealChrome} onGesture={setGestureActive} onToggleChrome={() => setChromeVisible((visible) => !visible)} viewer={viewer}>
        {bootstrap?.newerPhotoId !== undefined ? (
          <NavButton ariaLabel="Previous" icon="left" onClick={() => viewer.intents.showPrevious()} />
        ) : null}
        {bootstrap?.olderPhotoId !== undefined ? (
          <NavButton ariaLabel="Next" icon="right" onClick={() => viewer.intents.showNext()} />
        ) : null}
      </ViewerMediaStage>}

      {infoOpen && bootstrap ? <InfoPanel bootstrap={bootstrap} /> : null}
      {editorOpen && bootstrap ? (
        <CapturedAtEditorDialog
          chronology={bootstrap.chronology}
          collection={bootstrap.trashed ? "trashed" : "active"}
          historyBackSignal={editorHistoryBackSignal}
          onDismiss={closeEditor}
          onSuccess={(result) => {
            mutations.intents.chronologyChanged({ photoId: bootstrap.photoId, collection: bootstrap.trashed ? "trashed" : "active" });
            setChronologyAnnouncement(`${result.kind === "adjust" ? "Date and time adjusted" : "Date and time reverted"}. ${formatCapturedAt(result.capturedAt, "accessible")}. ${capturedAtSourceLabel(result.source)}.`);
            viewer.intents.refresh();
          }}
          photoId={bootstrap.photoId}
          port={createHttpCapturedAtEditorPort()}
          restoreHistoryEntry={() => navigate(location.pathname, { state: { ...(location.state ?? {}), capturedAtEditor: true } })}
        />
      ) : null}
      {permanentDeletionOpen ? (
        <PermanentDeletionDialog
          onCancel={() => { setPermanentDeletionOpen(false); window.setTimeout(() => moreButtonRef.current?.focus(), 0); }}
          onConfirm={confirmPermanentDeletion}
          target="photo"
        />
      ) : null}
      {chronologyAnnouncement ? <p aria-atomic="true" aria-live="polite" className="sr-only" role="status">{chronologyAnnouncement}</p> : null}
      {photoAnnouncement ? <p aria-atomic="true" aria-live="polite" className="sr-only">{photoAnnouncement}</p> : null}
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
      onPointerDown={(event) => event.stopPropagation()}
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
  requestedFavourites,
}: {
  currentCollection: "active" | "trashed";
  onReturn: () => void;
  onSwitch: () => void;
  /** This exact request asked for `collection=favourite`; the client phrases the notice around
      that (decision 7) rather than claiming the Photo "moved", since it may simply have been
      unfavourited without leaving the Timeline at all. */
  requestedFavourites: boolean;
}) {
  const destinationLabel = currentCollection === "trashed" ? "Trash" : "Timeline";
  return (
    <div className="flex max-w-sm flex-col items-center gap-3 text-center">
      <p>
        {requestedFavourites
          ? "This photo is no longer a Favourite."
          : `This photo moved to ${destinationLabel} since you opened it.`}
      </p>
      <div className="flex gap-2">
        <button
          className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-ink"
          onClick={onSwitch}
          type="button"
        >
          View in {destinationLabel}
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
    <aside aria-label="Photo information" className="max-h-[40vh] overflow-y-auto border-t border-white/10 bg-darkroom-elevated p-4 text-sm" id="photo-information" role="region">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
        {bootstrap.trashed && bootstrap.deletedAt !== undefined ? (
          <>
            <dt className="font-semibold text-white/70">Retention</dt>
            {/* This is where restore-or-let-it-go is actually decided (§6), so the days-remaining
                line stands beside the rest of the Photo's metadata rather than only in the grid. */}
            <dd className={isRetentionUrgent(daysRemainingInTrash(bootstrap.deletedAt)) ? "font-semibold text-danger" : undefined}>
              {retentionBadgeLabel(daysRemainingInTrash(bootstrap.deletedAt))}
            </dd>
          </>
        ) : null}
        <dt className="font-semibold text-white/70">Captured</dt>
        <dd>{formatCapturedAt(bootstrap.chronology.active.capturedAt, "detail")}</dd>
        <dt className="font-semibold text-white/70">Source</dt>
        <dd>{capturedAtSourceLabel(bootstrap.chronology.active.source)}</dd>
        {bootstrap.metadata?.cameraMake ? (
          <>
            <dt className="font-semibold text-white/70">Camera</dt>
            <dd className="break-words">{[bootstrap.metadata.cameraMake, bootstrap.metadata.cameraModel].filter(Boolean).join(" ")}</dd>
          </>
        ) : null}
        {bootstrap.metadata?.lensModel ? (
          <>
            <dt className="font-semibold text-white/70">Lens</dt>
            <dd className="break-words">{bootstrap.metadata.lensModel}</dd>
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
