import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type RefObject } from "react";
import { Minus, Trash2, Upload, X } from "lucide-react";
import { Link } from "react-router";
import { uiMessages } from "../../lib/uiMessages.js";
import { messageForReasonCode } from "../processing-issues/reasonMessage.js";
import type {
  UploadTray as UploadTrayModule,
  UploadTrayCompletion,
  UploadTraySelectionEntry,
  UploadTraySnapshot,
  UploadTrayTransfer,
} from "./uploadTray.js";
import { useUploadTraySnapshot } from "./useUploadTray.js";

interface UploadTrayProps {
  tray: UploadTrayModule;
}

const GLOBAL_ADD_PHOTOS_BUTTON_ID = "album-add-photos-button";

/**
 * Above-the-router, route-surviving upload surface (implementation doc
 * "Upload Tray"). Renders nothing while closed, a persistent progress bar
 * while minimised, and a full sheet -- a bottom sheet on narrow viewports --
 * otherwise. A non-modal named dialog: it never traps focus or makes the rest
 * of the page inert, so it can stay open across route changes and Tab may
 * leave it at any time.
 */
export function UploadTrayPanel({ tray }: UploadTrayProps) {
  const snapshot = useUploadTraySnapshot(tray);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const minimizedButtonRef = useRef<HTMLButtonElement>(null);
  const wasVisibleRef = useRef(snapshot.visible);
  const wasMinimizedRef = useRef(snapshot.minimized);
  const [announcement, setAnnouncement] = useState("");
  const announcedBatchIdRef = useRef<string | undefined>(undefined);
  const announcedFailureIdsRef = useRef<Set<string>>(new Set());
  const announcedTerminalBatchIdRef = useRef<string | undefined>(undefined);

  const hasBatch = snapshot.uploadBatchId !== undefined;
  const canClose = !hasBatch || snapshot.terminal;

  // Focus the heading on open and on restore from minimised; focus the persistent progress
  // button on minimise; focus the global "Add photos" trigger on dismiss. Each only fires on
  // the transition it names, never on every render (implementation doc "Upload Tray").
  useEffect(() => {
    if (snapshot.visible && !snapshot.minimized && (!wasVisibleRef.current || wasMinimizedRef.current)) {
      headingRef.current?.focus();
    } else if (snapshot.visible && snapshot.minimized && !wasMinimizedRef.current) {
      minimizedButtonRef.current?.focus();
    } else if (!snapshot.visible && wasVisibleRef.current) {
      document.getElementById(GLOBAL_ADD_PHOTOS_BUTTON_ID)?.focus();
    }
    wasVisibleRef.current = snapshot.visible;
    wasMinimizedRef.current = snapshot.minimized;
  }, [snapshot.visible, snapshot.minimized]);

  // Escape dismisses a pristine or terminal Tray, and minimises one with active work, matching
  // the header close button's own availability (`canClose`).
  useEffect(() => {
    if (!snapshot.visible || snapshot.minimized) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      if (canClose) {
        tray.intents.dismiss();
      } else {
        tray.intents.minimize();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [snapshot.visible, snapshot.minimized, canClose, tray]);

  // Batch-level milestones and file-level failures only -- no percent/poll chatter -- each
  // announced once by id so minimising and restoring never replays them.
  useEffect(() => {
    if (snapshot.uploadBatchId !== undefined && announcedBatchIdRef.current !== snapshot.uploadBatchId) {
      announcedBatchIdRef.current = snapshot.uploadBatchId;
      const count = snapshot.transfers.length;
      setAnnouncement(count === 1 ? "Uploading 1 photo" : `Uploading ${count} photos`);
    }
  }, [snapshot.uploadBatchId, snapshot.transfers.length]);

  useEffect(() => {
    for (const transfer of snapshot.transfers) {
      const failed = transfer.transferState === "failed" || transfer.processingState === "processingFailed";
      if (failed && !announcedFailureIdsRef.current.has(transfer.id)) {
        announcedFailureIdsRef.current.add(transfer.id);
        setAnnouncement(`${transfer.fileName} needs attention`);
      }
    }
  }, [snapshot.transfers]);

  useEffect(() => {
    if (
      snapshot.terminal &&
      snapshot.completion &&
      snapshot.uploadBatchId !== undefined &&
      announcedTerminalBatchIdRef.current !== snapshot.uploadBatchId
    ) {
      announcedTerminalBatchIdRef.current = snapshot.uploadBatchId;
      setAnnouncement(summaryLabel(snapshot.completion));
    }
  }, [snapshot.terminal, snapshot.completion, snapshot.uploadBatchId]);

  if (!snapshot.visible) {
    return null;
  }

  const announcer = (
    <div aria-live="polite" className="sr-only" role="status">
      {announcement}
    </div>
  );

  if (snapshot.minimized) {
    return (
      <>
        {announcer}
        <MinimizedBar buttonRef={minimizedButtonRef} onExpand={tray.intents.open} snapshot={snapshot} />
      </>
    );
  }

  const onFilesChosen = (files: FileList | null): void => {
    if (!files || files.length === 0) {
      return;
    }
    tray.intents.addFiles([...files]);
  };

  const validCount = snapshot.selection.filter((entry) => entry.valid).length;

  return (
    <>
      {announcer}
      <div aria-label={uiMessages.uploadTray.title} className="upload-tray" role="dialog">
        <div className="upload-tray-panel">
          {/* A plain div, not <header>: it would register as a second "banner" landmark
              alongside the shell's own <header> (axe landmark-unique). */}
          <div className="upload-tray-header">
            <h2 ref={headingRef} tabIndex={-1}>{uiMessages.uploadTray.title}</h2>
            <div className="upload-tray-header-actions">
              <button aria-label={uiMessages.uploadTray.minimize} onClick={tray.intents.minimize} type="button">
                <Minus aria-hidden="true" className="h-4 w-4" />
              </button>
              {canClose ? (
                <button aria-label={uiMessages.uploadTray.close} onClick={tray.intents.dismiss} type="button">
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>

          {snapshot.terminal && snapshot.completion ? (
            <CompletionSummary
              completion={snapshot.completion}
              jumping={snapshot.jumping}
              onDismiss={tray.intents.dismiss}
              onViewNewPhotos={tray.intents.viewNewPhotos}
              transfers={snapshot.transfers}
            />
          ) : hasBatch ? (
            <TransferList transfers={snapshot.transfers} />
          ) : (
            <>
              <div
                className={`upload-tray-dropzone${dragging ? " upload-tray-dropzone--active" : ""}`}
                onDragLeave={() => setDragging(false)}
                onDragOver={(event: DragEvent<HTMLDivElement>) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDrop={(event: DragEvent<HTMLDivElement>) => {
                  event.preventDefault();
                  setDragging(false);
                  onFilesChosen(event.dataTransfer.files);
                }}
              >
                <p>{uiMessages.uploadTray.dragAndDrop}</p>
                <button onClick={() => inputRef.current?.click()} type="button">
                  {uiMessages.uploadTray.choosePhotos}
                </button>
                <input
                  accept="image/jpeg,image/png,image/heic,image/heif,.jpg,.jpeg,.png,.heic,.heif"
                  aria-label={uiMessages.uploadTray.choosePhotos}
                  className="sr-only"
                  multiple
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    onFilesChosen(event.target.files);
                    event.target.value = "";
                  }}
                  ref={inputRef}
                  type="file"
                />
              </div>

              {snapshot.selection.length > 0 ? (
                <ul className="upload-tray-selection">
                  {snapshot.selection.map((entry) => (
                    <SelectionRow entry={entry} key={entry.id} onRemove={() => tray.intents.removeFile(entry.id)} />
                  ))}
                </ul>
              ) : null}

              {snapshot.selectionWarning ? <p className="upload-tray-warning">{snapshot.selectionWarning}</p> : null}

              <button
                className="upload-tray-submit"
                disabled={snapshot.submitting || validCount === 0 || snapshot.selectionWarning !== undefined}
                onClick={tray.intents.startUpload}
                type="button"
              >
                <Upload aria-hidden="true" className="h-4 w-4" />
                {validCount === 1 ? "Upload 1 photo" : `Upload ${validCount} photos`}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function SelectionRow({ entry, onRemove }: { entry: UploadTraySelectionEntry; onRemove: () => void }) {
  const urlRef = useRef<string | undefined>(undefined);
  const [previewFailed, setPreviewFailed] = useState(false);
  if (urlRef.current === undefined && typeof URL.createObjectURL === "function") {
    urlRef.current = URL.createObjectURL(entry.file);
  }
  useEffect(
    () => () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
      }
    },
    [],
  );

  const showPreview = entry.valid && !previewFailed && urlRef.current !== undefined;

  return (
    <li className="upload-tray-selection-row">
      <div className="upload-tray-thumb">
        {showPreview ? (
          <img alt="" decoding="async" loading="lazy" onError={() => setPreviewFailed(true)} src={urlRef.current} />
        ) : (
          <span className="upload-tray-thumb-fallback">{uiMessages.uploadTray.previewUnavailable}</span>
        )}
      </div>
      <div className="upload-tray-selection-meta">
        <p title={entry.fileName}>{entry.fileName}</p>
        {!entry.valid ? <p className="upload-tray-warning">{entry.validationReason}</p> : null}
      </div>
      <button aria-label={`Remove ${entry.fileName}`} onClick={onRemove} type="button">
        <Trash2 aria-hidden="true" className="h-4 w-4" />
      </button>
    </li>
  );
}

function TransferList({ transfers }: { transfers: UploadTrayTransfer[] }) {
  return (
    <ul className="upload-tray-transfers">
      {transfers.map((transfer) => (
        <li key={transfer.id}>
          <p>{transfer.fileName}</p>
          <p className="upload-tray-transfer-state">{labelForTransfer(transfer)}</p>
          {transfer.transferState === "uploading" ? <progress max={100} value={transfer.progress} /> : null}
          {transfer.transferError ? <p className="upload-tray-warning">{transfer.transferError}</p> : null}
          {transfer.processingState === "processingFailed" && transfer.failureCode ? (
            <p className="upload-tray-warning">{messageForReasonCode(transfer.failureCode)}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

const labelForTransfer = (transfer: UploadTrayTransfer): string => {
  if (transfer.transferState === "uploading") {
    return `${uiMessages.uploadTray.uploading} ${transfer.progress}%`;
  }
  if (transfer.transferState === "failed") {
    return transfer.transferError ?? "Upload failed";
  }
  if (transfer.processingState === "ready") {
    return uiMessages.uploadTray.ready;
  }
  if (transfer.processingState === "exactDuplicate") {
    return uiMessages.uploadTray.exactDuplicate;
  }
  if (transfer.processingState === "processingFailed") {
    return uiMessages.uploadTray.needsAttention;
  }
  return uiMessages.uploadTray.processing;
};

function CompletionSummary({
  completion,
  jumping,
  onDismiss,
  onViewNewPhotos,
  transfers,
}: {
  completion: UploadTrayCompletion;
  jumping: boolean;
  onDismiss: () => void;
  onViewNewPhotos: () => void;
  transfers: UploadTrayTransfer[];
}) {
  const duplicateWithLink = transfers.find(
    (transfer) => transfer.processingState === "exactDuplicate" && transfer.duplicateOfPhotoId !== undefined,
  );

  return (
    <div className="upload-tray-completion">
      <ul>
        <li>{completion.added} added</li>
        <li>
          {completion.alreadyInAlbum} already in your album
          {duplicateWithLink ? <Link to={`/album/photos/${duplicateWithLink.duplicateOfPhotoId}`}>View</Link> : null}
        </li>
        <li>
          {completion.needsAttention} needs attention
          {completion.needsAttention > 0 ? (
            <Link to="/album/processing-issues">{uiMessages.uploadTray.reviewProcessingIssues}</Link>
          ) : null}
        </li>
      </ul>
      <div className="upload-tray-completion-actions">
        {completion.newestReadyTimelineAnchor !== undefined ? (
          <button disabled={jumping} onClick={onViewNewPhotos} type="button">
            {uiMessages.uploadTray.viewNewPhotos}
          </button>
        ) : null}
        <button onClick={onDismiss} type="button">
          {uiMessages.uploadTray.done}
        </button>
      </div>
    </div>
  );
}

function MinimizedBar({
  buttonRef,
  onExpand,
  snapshot,
}: {
  buttonRef: RefObject<HTMLButtonElement | null>;
  onExpand: () => void;
  snapshot: UploadTraySnapshot;
}) {
  const total = snapshot.transfers.length || snapshot.selection.length;
  const uploaded = snapshot.transfers.filter((transfer) => transfer.transferState === "uploaded").length;
  const label =
    snapshot.terminal && snapshot.completion
      ? summaryLabel(snapshot.completion)
      : `Uploading ${uploaded}/${total}`;

  return (
    <button
      aria-label={uiMessages.uploadTray.expand}
      className="upload-tray-bar"
      onClick={onExpand}
      ref={buttonRef}
      type="button"
    >
      <Upload aria-hidden="true" className="h-4 w-4" />
      <span>{label}</span>
    </button>
  );
}

const summaryLabel = (completion: UploadTrayCompletion): string => {
  const parts = [`${completion.added} added`];
  if (completion.alreadyInAlbum > 0) {
    parts.push(`${completion.alreadyInAlbum} already in your album`);
  }
  if (completion.needsAttention > 0) {
    parts.push(`${completion.needsAttention} needs attention`);
  }
  return parts.join(" · ");
};
