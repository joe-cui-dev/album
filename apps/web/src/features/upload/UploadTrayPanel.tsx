import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Minus, Trash2, Upload, X } from "lucide-react";
import { Link } from "react-router";
import { uiMessages } from "../../lib/uiMessages.js";
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

/**
 * Above-the-router, route-surviving upload surface (implementation doc
 * "Upload Tray"). Renders nothing while closed, a persistent progress bar
 * while minimised, and a full sheet -- a bottom sheet on narrow viewports --
 * otherwise.
 */
export function UploadTrayPanel({ tray }: UploadTrayProps) {
  const snapshot = useUploadTraySnapshot(tray);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  if (!snapshot.visible) {
    return null;
  }

  if (snapshot.minimized) {
    return <MinimizedBar onExpand={tray.intents.open} snapshot={snapshot} />;
  }

  const onFilesChosen = (files: FileList | null): void => {
    if (!files || files.length === 0) {
      return;
    }
    tray.intents.addFiles([...files]);
  };

  const hasBatch = snapshot.uploadBatchId !== undefined;
  const validCount = snapshot.selection.filter((entry) => entry.valid).length;
  const canClose = !hasBatch || snapshot.terminal;

  return (
    <div aria-label={uiMessages.uploadTray.title} aria-modal="true" className="upload-tray" role="dialog">
      <div className="upload-tray-panel">
        <header className="upload-tray-header">
          <h2>{uiMessages.uploadTray.title}</h2>
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
        </header>

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
        <p>{entry.fileName}</p>
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
          {transfer.processingState === "processingFailed" && transfer.failureMessage ? (
            <p className="upload-tray-warning">{transfer.failureMessage}</p>
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

function MinimizedBar({ onExpand, snapshot }: { onExpand: () => void; snapshot: UploadTraySnapshot }) {
  const total = snapshot.transfers.length || snapshot.selection.length;
  const uploaded = snapshot.transfers.filter((transfer) => transfer.transferState === "uploaded").length;
  const label =
    snapshot.terminal && snapshot.completion
      ? summaryLabel(snapshot.completion)
      : `Uploading ${uploaded}/${total}`;

  return (
    <button aria-label={uiMessages.uploadTray.expand} className="upload-tray-bar" onClick={onExpand} type="button">
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
