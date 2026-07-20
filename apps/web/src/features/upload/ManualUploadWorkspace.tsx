import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import type { GetUploadBatchStatusResponse, UploadBatchPhotoStatus } from "@album/shared";
import { apiClient } from "../../lib/apiClient.js";
import {
  validatePhotoFile,
  validateUploadBatchFiles,
} from "./fileValidation.js";
import { hashFile } from "./hashFile.js";
import { isTerminalProcessingState } from "./uploadState.js";
import { uploadToS3 } from "./uploadToS3.js";

interface SelectedPhotoFile {
  id: string;
  file: File;
  valid: boolean;
  reason: string | undefined;
}

/**
 * A temporary standalone workspace for file selection, direct S3 upload,
 * Upload Batch polling, and Retry -- split out of the legacy `UploadPage` so
 * the Timeline/Archive route cutover doesn't have to carry upload mechanics
 * (docs/browsing-tracer-implementation.md, Slice 3).
 */
export function ManualUploadWorkspace() {
  const [selectedFiles, setSelectedFiles] = useState<SelectedPhotoFile[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [uploadBatchId, setUploadBatchId] = useState<string>();
  const [batchStatus, setBatchStatus] = useState<GetUploadBatchStatusResponse>();
  const [retryPolling, setRetryPolling] = useState(false);
  const [warning, setWarning] = useState<string>();
  const [error, setError] = useState<string>();
  const [uploading, setUploading] = useState(false);

  const validFiles = useMemo(
    () => selectedFiles.filter((selectedFile) => selectedFile.valid),
    [selectedFiles],
  );
  const batchValidation = useMemo(
    () => validateUploadBatchFiles(validFiles.map((selectedFile) => selectedFile.file)),
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
    setWarning(nextBatchValidation.valid ? undefined : nextBatchValidation.reason);
  };

  const removeFile = (id: string) => {
    setSelectedFiles((current) => current.filter((file) => file.id !== id));
  };

  const createUploadBatch = async () => {
    setUploading(true);
    setError(undefined);
    setWarning(undefined);

    try {
      const validation = validateUploadBatchFiles(validFiles.map((selectedFile) => selectedFile.file));
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

      const batch = await apiClient.createUploadBatch({
        files,
        uploadContext: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      });
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
    <main className="album-content">
      <section className="grid gap-6 py-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <h1 className="text-2xl font-bold text-stone-950">Add photos</h1>

          <label className="block rounded-lg border border-dashed border-stone-300 bg-white p-5">
            <span className="text-sm font-semibold text-stone-800">Choose photos</span>
            <input
              accept="image/jpeg,image/png,image/heic,image/heif,.jpg,.jpeg,.png,.heic,.heif"
              id="photo-file-input"
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
                      <p className="font-semibold text-stone-950">{selectedFile.file.name}</p>
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
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{warning}</p>
          ) : null}
          {error ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>
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

          <UploadBatchStatus progress={uploadProgress} onRetry={retryProcessing} status={batchStatus} />
        </aside>
      </section>
    </main>
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
          <PhotoStatusRow key={photo.photoId} onRetry={onRetry} photo={photo} progress={progress} />
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
      <p className="mt-1 text-sm text-stone-600">Upload progress: {progress[photo.photoId] ?? 0}%</p>
      <p className="mt-1 text-sm font-semibold text-stone-800">
        Processing state: {labelProcessingState(photo.processingState)}
      </p>
      {photo.exactDuplicate ? (
        <p className="mt-1 text-sm font-semibold text-amber-800">Exact duplicate</p>
      ) : null}
      {photo.failureMessage ? (
        <p className="mt-1 text-sm font-semibold text-red-700">{photo.failureMessage}</p>
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
    processing: "Processing",
    ready: "Ready",
    processingFailed: "Processing failed",
    exactDuplicate: "Exact duplicate",
  })[state];
