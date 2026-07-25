import type { CreateUploadBatchRequest, CreateUploadBatchResponse, GetUploadBatchStatusResponse } from "@album/shared";
import { albumTransport } from "../../lib/albumTransport.js";
import { createHttpAlbumBrowsingPort } from "../browsing/httpAlbumBrowsingPort.js";
import { probeDateJump, type DateJumpResult } from "../browsing/dateJump.js";
import { uploadToS3 } from "./uploadToS3.js";

/**
 * `uploadTray`'s owned internal network seam (ADR-0068). Production gets an
 * HTTP adapter, tests a scripted one; the deep module never imports the
 * global HTTP client directly.
 */
export interface UploadTrayPort {
  createUploadBatch(
    input: CreateUploadBatchRequest & { signal: AbortSignal },
  ): Promise<CreateUploadBatchResponse>;

  getUploadBatchStatus(input: { uploadBatchId: string; signal: AbortSignal }): Promise<GetUploadBatchStatusResponse>;

  uploadFile(input: {
    file: File;
    uploadUrl: string;
    onProgress: (percent: number) => void;
    signal: AbortSignal;
  }): Promise<void>;

  /** "View new photos": probes the "active" collection at `targetAnchor` before the caller navigates (ADR-0058, ADR-0041). */
  probeDateJump(input: { targetAnchor: string; signal: AbortSignal }): Promise<DateJumpResult>;
}

export const createHttpUploadTrayPort = (): UploadTrayPort => {
  const browsingPort = createHttpAlbumBrowsingPort();

  return {
    createUploadBatch: ({ files, uploadContext, signal }) =>
      albumTransport.request("/upload-batches", {
        method: "POST",
        body: { files, uploadContext },
        signal,
      }),

    getUploadBatchStatus: ({ uploadBatchId, signal }) =>
      albumTransport.request(`/upload-batches/${uploadBatchId}`, { signal }),

    uploadFile: ({ file, uploadUrl, onProgress, signal }) =>
      uploadToS3({ file, uploadUrl, onProgress, signal }),

    probeDateJump: ({ targetAnchor, signal }) =>
      probeDateJump({ collection: "active", targetAnchor, port: browsingPort, signal }),
  };
};
