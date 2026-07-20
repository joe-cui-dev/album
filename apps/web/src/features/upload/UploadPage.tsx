import { useState } from "react";
import { Archive, Download, Image, RefreshCw } from "lucide-react";
import { Link } from "react-router";
import type { GetPhotoDetailResponse, TimelinePhoto } from "@album/shared";
import { apiClient } from "../../lib/apiClient.js";
import { uiMessages } from "../../lib/uiMessages.js";

interface UploadPageProps {
  destination: "archive" | "timeline";
}

export function UploadPage({ destination }: UploadPageProps) {
  const [timelinePhotos, setTimelinePhotos] = useState<TimelinePhoto[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<GetPhotoDetailResponse>();
  const [displayUrl, setDisplayUrl] = useState<string>();
  const [originalDownloadUrl, setOriginalDownloadUrl] = useState<string>();
  const [timelineYear, setTimelineYear] = useState("");
  const [timelineMonth, setTimelineMonth] = useState("");
  const [timelineProcessingState, setTimelineProcessingState] = useState("");
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [error, setError] = useState<string>();

  const refreshTimeline = async () => {
    setTimelineLoading(true);
    setError(undefined);
    try {
      const response = await apiClient.listTimelinePhotos(
        removeEmptyQuery({
          year: timelineYear,
          month: timelineMonth,
          processingState: timelineProcessingState,
          archived: destination === "archive" ? "true" : "",
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

  const isEmptyDestination = timelinePhotos.length === 0;

  if (isEmptyDestination) {
    const emptyState =
      destination === "archive" ? uiMessages.emptyArchive : uiMessages.emptyAlbum;

    return (
      <main className="album-content">
        <section className="empty-album">
          <h1>{emptyState.title}</h1>
          <p>{emptyState.description}</p>
          {destination === "timeline" ? (
            <>
              <Link
                className="inline-flex min-h-10 items-center justify-center rounded-md bg-emerald-800 px-4 font-bold text-white"
                to="/album/upload"
              >
                {uiMessages.addPhotos}
              </Link>
              <small>{uiMessages.emptyAlbum.formats}</small>
            </>
          ) : null}
          <button
            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-900 disabled:text-stone-500"
            disabled={timelineLoading}
            onClick={refreshTimeline}
            type="button"
          >
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            {destination === "archive" ? "Refresh archive" : "Refresh timeline"}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="album-content">
      <section className="grid gap-5 border-b border-stone-200 py-8 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold text-stone-950">
                {destination === "archive" ? "Archive" : "Timeline"}
              </h2>
              <p className="mt-1 text-sm text-stone-600">
                {timelinePhotos.length
                  ? `${timelinePhotos.length} photos`
                  : destination === "archive"
                    ? "No archived photos"
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
              {destination === "archive" ? "Refresh archive" : "Refresh timeline"}
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
                <option value="uploadRequested">Upload requested</option>
              </select>
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

      {error ? (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          {error}
        </p>
      ) : null}
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

const labelProcessingState = (state: GetPhotoDetailResponse["processingState"]) =>
  ({
    uploadRequested: "Upload requested",
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
