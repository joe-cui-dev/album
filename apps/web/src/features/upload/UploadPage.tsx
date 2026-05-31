import { ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Download,
  Image,
  LogOut,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import type {
  GetPhotoDetailResponse,
  GetUploadBatchStatusResponse,
  TimelinePhoto,
  SessionUser,
  UploadBatchPhotoStatus,
} from "@album/shared";
import { apiClient } from "../../lib/apiClient.js";
import {
  validatePhotoFile,
  validateUploadBatchFiles,
} from "./fileValidation.js";
import { hashFile } from "./hashFile.js";
import { isTerminalProcessingState } from "./uploadState.js";
import { uploadToS3 } from "./uploadToS3.js";

interface UploadPageProps {
  user: SessionUser;
  onSignedOut: () => void;
}

interface SelectedPhotoFile {
  id: string;
  file: File;
  valid: boolean;
  reason: string | undefined;
}

export function UploadPage({ user, onSignedOut }: UploadPageProps) {
  const [selectedFiles, setSelectedFiles] = useState<SelectedPhotoFile[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [uploadBatchId, setUploadBatchId] = useState<string>();
  const [batchStatus, setBatchStatus] = useState<GetUploadBatchStatusResponse>();
  const [timelinePhotos, setTimelinePhotos] = useState<TimelinePhoto[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<GetPhotoDetailResponse>();
  const [displayUrl, setDisplayUrl] = useState<string>();
  const [originalDownloadUrl, setOriginalDownloadUrl] = useState<string>();
  const [timelineYear, setTimelineYear] = useState("");
  const [timelineMonth, setTimelineMonth] = useState("");
  const [timelineProcessingState, setTimelineProcessingState] = useState("");
  const [showArchivedTimeline, setShowArchivedTimeline] = useState(false);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [retryPolling, setRetryPolling] = useState(false);
  const [warning, setWarning] = useState<string>();
  const [error, setError] = useState<string>();
  const [uploading, setUploading] = useState(false);

  const validFiles = useMemo(
    () => selectedFiles.filter((selectedFile) => selectedFile.valid),
    [selectedFiles],
  );
  const batchValidation = useMemo(
    () =>
      validateUploadBatchFiles(
        validFiles.map((selectedFile) => selectedFile.file),
      ),
    [validFiles],
  );

  useEffect(() => {
    if (!uploadBatchId || !batchStatus) {
      return;
    }
    if (
      !retryPolling &&
      batchStatus.photos.every((photo) => isTerminalProcessingState(photo.processingState))
    ) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshUploadBatchStatus(uploadBatchId);
    }, 2000);

    return () => window.clearInterval(intervalId);
  }, [batchStatus, retryPolling, uploadBatchId]);

  const chooseFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])].map((file) => {
      const validation = validatePhotoFile(file);
      return {
        id: `${file.name}-${file.lastModified}-${file.size}`,
        file,
        valid: validation.valid,
        reason: validation.reason,
      };
    });
    const nextValidFiles = files
      .filter((selectedFile) => selectedFile.valid)
      .map((selectedFile) => selectedFile.file);
    const nextBatchValidation = validateUploadBatchFiles(nextValidFiles);

    setSelectedFiles(files);
    setUploadBatchId(undefined);
    setBatchStatus(undefined);
    setRetryPolling(false);
    setUploadProgress({});
    setError(undefined);
    setWarning(
      nextBatchValidation.valid ? undefined : nextBatchValidation.reason,
    );
  };

  const removeFile = (id: string) => {
    setSelectedFiles((current) => current.filter((file) => file.id !== id));
  };

  const signOut = async () => {
    await apiClient.signOut();
    onSignedOut();
  };

  const refreshTimeline = async () => {
    setTimelineLoading(true);
    setError(undefined);
    try {
      const response = await apiClient.listTimelinePhotos(
        removeEmptyQuery({
          year: timelineYear,
          month: timelineMonth,
          processingState: timelineProcessingState,
          archived: showArchivedTimeline ? "true" : "",
        }),
      );
      setTimelinePhotos(response.photos);
      if (
        selectedPhoto &&
        !response.photos.some((photo) => photo.photoId === selectedPhoto.photoId)
      ) {
        setSelectedPhoto(undefined);
        setDisplayUrl(undefined);
        setOriginalDownloadUrl(undefined);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Timeline failed");
    } finally {
      setTimelineLoading(false);
    }
  };

  const openPhoto = async (photoId: string) => {
    setError(undefined);
    setOriginalDownloadUrl(undefined);
    try {
      const detail = await apiClient.getPhotoDetail(photoId);
      setSelectedPhoto(detail);
      if (detail.processingState === "ready") {
        const access = await apiClient.createDisplayAccessUrl(photoId);
        setDisplayUrl(access.url);
      } else {
        setDisplayUrl(undefined);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Photo detail failed");
    }
  };

  const archiveSelectedPhoto = async () => {
    if (!selectedPhoto) {
      return;
    }
    await apiClient.archivePhoto(selectedPhoto.photoId);
    await refreshTimeline();
  };

  const createOriginalDownload = async () => {
    if (!selectedPhoto) {
      return;
    }
    const response = await apiClient.createOriginalDownloadUrl(selectedPhoto.photoId);
    setOriginalDownloadUrl(response.url);
  };

  const createUploadBatch = async () => {
    setUploading(true);
    setError(undefined);
    setWarning(undefined);

    try {
      const validation = validateUploadBatchFiles(
        validFiles.map((selectedFile) => selectedFile.file),
      );
      if (!validation.valid) {
        setWarning(validation.reason);
        return;
      }

      const files = await Promise.all(
        validFiles.map(async ({ file }) => {
          let clientSha256: string | undefined;
          try {
            clientSha256 = await hashFile(file);
          } catch {
            setWarning("Could not calculate SHA-256 for one or more files.");
          }

          return {
            fileName: file.name,
            contentType: file.type,
            fileSizeBytes: file.size,
            ...(clientSha256 ? { clientSha256 } : {}),
            fileModifiedAt: new Date(file.lastModified).toISOString(),
          };
        }),
      );

      const batch = await apiClient.createUploadBatch({ files });
      setUploadBatchId(batch.uploadBatchId);
      setRetryPolling(false);
      await Promise.all(
        batch.uploads.map(async (upload, index) => {
          const file = validFiles[index]?.file;
          if (!file) {
            return;
          }
          await uploadToS3({
            file,
            uploadUrl: upload.uploadUrl,
            onProgress: (percent) =>
              setUploadProgress((current) => ({
                ...current,
                [upload.photoId]: percent,
              })),
          });
        }),
      );
      await refreshUploadBatchStatus(batch.uploadBatchId);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const refreshUploadBatchStatus = async (batchId: string) => {
    const status = await apiClient.getUploadBatchStatus(batchId);
    setBatchStatus(status);
    if (status.photos.every((photo) => isTerminalProcessingState(photo.processingState))) {
      setRetryPolling(false);
    }
  };

  const retryProcessing = async (photoId: string) => {
    await apiClient.retryProcessing(photoId);
    setRetryPolling(true);
  };

  const uploadButtonLabel =
    validFiles.length === 1 ? "Upload 1 photo" : `Upload ${validFiles.length} photos`;

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-stone-200 pb-6">
        <div>
          <p className="text-sm font-semibold uppercase text-emerald-700">
            Personal Album
          </p>
          <h1 className="mt-2 text-4xl font-bold text-stone-950">Manual upload</h1>
          <p className="mt-2 text-stone-600">Signed in as {user.email}</p>
        </div>
        <button
          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-stone-300 bg-white px-4 font-semibold text-stone-900"
          onClick={signOut}
          type="button"
        >
          <LogOut aria-hidden="true" className="h-4 w-4" />
          Sign out
        </button>
      </header>

      <section className="grid gap-5 border-b border-stone-200 py-8 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold text-stone-950">Timeline</h2>
              <p className="mt-1 text-sm text-stone-600">
                {timelinePhotos.length
                  ? `${timelinePhotos.length} photos`
                  : "No timeline photos"}
              </p>
            </div>
            <button
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-900 disabled:text-stone-500"
              disabled={timelineLoading}
              onClick={refreshTimeline}
              type="button"
            >
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              Refresh timeline
            </button>
          </div>

          <div className="mt-4 grid gap-3 rounded-lg border border-stone-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm font-semibold text-stone-800">
              Year
              <input
                className="mt-1 block min-h-10 w-full rounded-md border border-stone-300 px-3 font-normal text-stone-950"
                inputMode="numeric"
                onChange={(event) => setTimelineYear(event.target.value)}
                placeholder="2025"
                type="text"
                value={timelineYear}
              />
            </label>
            <label className="text-sm font-semibold text-stone-800">
              Month
              <select
                className="mt-1 block min-h-10 w-full rounded-md border border-stone-300 px-3 font-normal text-stone-950"
                onChange={(event) => setTimelineMonth(event.target.value)}
                value={timelineMonth}
              >
                <option value="">All</option>
                {Array.from({ length: 12 }, (_, index) => (
                  <option key={index + 1} value={String(index + 1).padStart(2, "0")}>
                    {String(index + 1).padStart(2, "0")}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-semibold text-stone-800">
              State
              <select
                className="mt-1 block min-h-10 w-full rounded-md border border-stone-300 px-3 font-normal text-stone-950"
                onChange={(event) => setTimelineProcessingState(event.target.value)}
                value={timelineProcessingState}
              >
                <option value="">Ready</option>
                <option value="processingFailed">Processing failed</option>
                <option value="exactDuplicate">Exact duplicate</option>
                <option value="processing">Processing</option>
                <option value="uploaded">Uploaded</option>
                <option value="uploadRequested">Upload requested</option>
              </select>
            </label>
            <label className="flex min-h-10 items-center gap-2 self-end text-sm font-semibold text-stone-800">
              <input
                checked={showArchivedTimeline}
                className="h-4 w-4"
                onChange={(event) => setShowArchivedTimeline(event.target.checked)}
                type="checkbox"
              />
              Archived
            </label>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {timelinePhotos.map((photo) => (
              <button
                aria-label={`Open ${photo.fileName}`}
                className="rounded-lg border border-stone-200 bg-white p-2 text-left hover:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-800"
                key={photo.photoId}
                onClick={() => void openPhoto(photo.photoId)}
                type="button"
              >
                {photo.timelineThumbnailUrl ? (
                  <img
                    alt={`${photo.fileName} thumbnail`}
                    className="aspect-square w-full rounded-md bg-stone-100 object-cover"
                    decoding="async"
                    loading="lazy"
                    src={photo.timelineThumbnailUrl}
                  />
                ) : (
                  <span className="flex aspect-square w-full items-center justify-center rounded-md bg-emerald-50 text-emerald-800">
                    <Image aria-hidden="true" className="h-6 w-6" />
                  </span>
                )}
                <span className="mt-2 block truncate text-sm font-semibold text-stone-950">
                  {photo.fileName}
                </span>
                <span className="mt-1 block truncate text-xs text-stone-600">
                  {formatDateTime(photo.capturedAt)}
                </span>
              </button>
            ))}
          </div>
        </div>

        <PhotoDetailPanel
          displayUrl={displayUrl}
          onArchive={() => void archiveSelectedPhoto()}
          onDownloadOriginal={() => void createOriginalDownload()}
          originalDownloadUrl={originalDownloadUrl}
          photo={selectedPhoto}
        />
      </section>

      <section className="grid gap-6 py-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <label className="block rounded-lg border border-dashed border-stone-300 bg-white p-5">
            <span className="text-sm font-semibold text-stone-800">Choose photos</span>
            <input
              accept="image/jpeg,image/png,image/heic,image/heif,.jpg,.jpeg,.png,.heic,.heif"
              className="mt-3 block w-full text-sm"
              multiple
              onChange={chooseFiles}
              type="file"
            />
          </label>

          {selectedFiles.length ? (
            <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
              <ul className="divide-y divide-stone-200">
                {selectedFiles.map((selectedFile) => (
                  <li
                    className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto]"
                    key={selectedFile.id}
                  >
                    <div>
                      <p className="font-semibold text-stone-950">
                        {selectedFile.file.name}
                      </p>
                      <p className="mt-1 text-sm text-stone-600">
                        {selectedFile.valid ? "Ready to upload" : selectedFile.reason}
                      </p>
                    </div>
                    <button
                      aria-label={`Remove ${selectedFile.file.name}`}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-stone-300 text-stone-700"
                      onClick={() => removeFile(selectedFile.id)}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {warning ? (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {warning}
            </p>
          ) : null}
          {error ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              {error}
            </p>
          ) : null}
        </div>

        <aside className="space-y-4">
          <button
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-emerald-800 px-4 font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-400"
            disabled={uploading || validFiles.length === 0 || !batchValidation.valid}
            onClick={createUploadBatch}
            type="button"
          >
            <Upload aria-hidden="true" className="h-4 w-4" />
            {uploadButtonLabel}
          </button>

          <UploadBatchStatus
            progress={uploadProgress}
            onRetry={retryProcessing}
            status={batchStatus}
          />
        </aside>
      </section>
    </main>
  );
}

function PhotoDetailPanel({
  displayUrl,
  onArchive,
  onDownloadOriginal,
  originalDownloadUrl,
  photo,
}: {
  displayUrl: string | undefined;
  onArchive: () => void;
  onDownloadOriginal: () => void;
  originalDownloadUrl: string | undefined;
  photo: GetPhotoDetailResponse | undefined;
}) {
  if (!photo) {
    return (
      <aside className="rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="text-lg font-bold text-stone-950">Photo detail</h2>
      </aside>
    );
  }

  return (
    <aside className="rounded-lg border border-stone-200 bg-white p-4">
      <h2 className="break-words text-lg font-bold text-stone-950">
        {photo.fileName}
      </h2>
      {displayUrl ? (
        <img
          alt={photo.fileName}
          className="mt-4 aspect-[4/3] w-full rounded-md object-cover"
          src={displayUrl}
        />
      ) : null}

      <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <dt className="font-semibold text-stone-700">Captured</dt>
        <dd className="text-stone-950">
          {photo.capturedAt ? formatDateTime(photo.capturedAt) : "Unknown"}
        </dd>
        <dt className="font-semibold text-stone-700">State</dt>
        <dd className="text-stone-950">{labelProcessingState(photo.processingState)}</dd>
        <dt className="font-semibold text-stone-700">Format</dt>
        <dd className="uppercase text-stone-950">{photo.format}</dd>
        <dt className="font-semibold text-stone-700">Size</dt>
        <dd className="text-stone-950">{formatBytes(photo.fileSizeBytes)}</dd>
        {photo.metadata?.width && photo.metadata.height ? (
          <>
            <dt className="font-semibold text-stone-700">Dimensions</dt>
            <dd className="text-stone-950">
              {photo.metadata.width} x {photo.metadata.height}
            </dd>
          </>
        ) : null}
        {photo.metadata?.cameraMake ? (
          <>
            <dt className="font-semibold text-stone-700">Camera</dt>
            <dd className="text-stone-950">
              {[photo.metadata.cameraMake, photo.metadata.cameraModel]
                .filter(Boolean)
                .join(" ")}
            </dd>
          </>
        ) : null}
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-900"
          onClick={onDownloadOriginal}
          type="button"
        >
          <Download aria-hidden="true" className="h-4 w-4" />
          Download original
        </button>
        <button
          className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-900"
          onClick={onArchive}
          type="button"
        >
          <Archive aria-hidden="true" className="h-4 w-4" />
          Archive photo
        </button>
      </div>
      {originalDownloadUrl ? (
        <a
          className="mt-3 inline-flex min-h-10 items-center rounded-md bg-emerald-800 px-3 text-sm font-bold text-white"
          href={originalDownloadUrl}
          rel="noreferrer"
          target="_blank"
        >
          Open original download
        </a>
      ) : null}
    </aside>
  );
}

function UploadBatchStatus({
  onRetry,
  progress,
  status,
}: {
  onRetry: (photoId: string) => void;
  progress: Record<string, number>;
  status: GetUploadBatchStatusResponse | undefined;
}) {
  const photos = status?.photos ?? [];

  if (!photos.length && !Object.keys(progress).length) {
    return null;
  }

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4">
      <h2 className="text-lg font-bold text-stone-950">Recent upload batch</h2>
      <ul className="mt-3 space-y-3">
        {photos.map((photo) => (
          <PhotoStatusRow
            key={photo.photoId}
            onRetry={onRetry}
            photo={photo}
            progress={progress}
          />
        ))}
      </ul>
    </section>
  );
}

function PhotoStatusRow({
  onRetry,
  photo,
  progress,
}: {
  onRetry: (photoId: string) => void;
  photo: UploadBatchPhotoStatus;
  progress: Record<string, number>;
}) {
  return (
    <li className="rounded-md border border-stone-200 p-3">
      <p className="font-semibold text-stone-950">{photo.fileName}</p>
      <p className="mt-1 text-sm text-stone-600">
        Upload progress: {progress[photo.photoId] ?? 0}%
      </p>
      <p className="mt-1 text-sm font-semibold text-stone-800">
        Processing state: {labelProcessingState(photo.processingState)}
      </p>
      {photo.exactDuplicate ? (
        <p className="mt-1 text-sm font-semibold text-amber-800">Exact duplicate</p>
      ) : null}
      {photo.failureMessage ? (
        <p className="mt-1 text-sm font-semibold text-red-700">
          {photo.failureMessage}
        </p>
      ) : null}
      {photo.processingState === "processingFailed" ? (
        <button
          className="mt-3 min-h-10 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-900"
          onClick={() => onRetry(photo.photoId)}
          type="button"
        >
          Retry {photo.fileName}
        </button>
      ) : null}
    </li>
  );
}

const labelProcessingState = (state: UploadBatchPhotoStatus["processingState"]) =>
  ({
    uploadRequested: "Upload requested",
    uploaded: "Uploaded",
    processing: "Processing",
    ready: "Ready",
    processingFailed: "Processing failed",
    exactDuplicate: "Exact duplicate",
  })[state];

const formatDateTime = (value: string): string => {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const removeEmptyQuery = (
  query: Record<string, string>,
): Record<string, string> => {
  return Object.fromEntries(
    Object.entries(query).filter(([, value]) => value.length > 0),
  );
};
