import type {
  TrashMembershipResponse,
  CreateTemporaryPhotoUrlResponse,
  RetryProcessingResponse,
} from "@album/shared";
import type { AlbumMutationsPort } from "./albumMutationsPort.js";

interface Deferred<T> {
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export interface SetTrashMembershipCall {
  photoId: string;
  trashed: boolean;
}

export interface RetryProcessingCall {
  photoId: string;
}

export interface PresignOriginalDownloadCall {
  photoId: string;
}

export interface TestAlbumMutationsPort {
  port: AlbumMutationsPort;
  setTrashMembershipCalls: SetTrashMembershipCall[];
  retryProcessingCalls: RetryProcessingCall[];
  presignOriginalDownloadCalls: PresignOriginalDownloadCall[];
  resolveNextSetTrashMembership(response: TrashMembershipResponse): void;
  rejectNextSetTrashMembership(error: unknown): void;
  resolveNextRetryProcessing(response: RetryProcessingResponse): void;
  rejectNextRetryProcessing(error: unknown): void;
  resolveNextPresignOriginalDownload(response: CreateTemporaryPhotoUrlResponse): void;
  rejectNextPresignOriginalDownload(error: unknown): void;
}

/** A fully controllable `albumMutations` port for deep-module tests: every call queues until the test resolves it. */
export const createTestAlbumMutationsPort = (): TestAlbumMutationsPort => {
  const setTrashMembershipCalls: SetTrashMembershipCall[] = [];
  const retryProcessingCalls: RetryProcessingCall[] = [];
  const presignOriginalDownloadCalls: PresignOriginalDownloadCall[] = [];
  const pendingSetTrashMembership: Array<Deferred<TrashMembershipResponse>> = [];
  const pendingRetryProcessing: Array<Deferred<RetryProcessingResponse>> = [];
  const pendingPresignOriginalDownload: Array<Deferred<CreateTemporaryPhotoUrlResponse>> = [];

  const port: AlbumMutationsPort = {
    setTrashMembership: ({ photoId, trashed, signal }) => {
      setTrashMembershipCalls.push({ photoId, trashed });
      return new Promise((resolve, reject) => {
        pendingSetTrashMembership.push({ resolve, reject });
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    },
    retryProcessing: ({ photoId, signal }) => {
      retryProcessingCalls.push({ photoId });
      return new Promise((resolve, reject) => {
        pendingRetryProcessing.push({ resolve, reject });
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    },
    presignOriginalDownload: ({ photoId, signal }) => {
      presignOriginalDownloadCalls.push({ photoId });
      return new Promise((resolve, reject) => {
        pendingPresignOriginalDownload.push({ resolve, reject });
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    },
  };

  return {
    port,
    setTrashMembershipCalls,
    retryProcessingCalls,
    presignOriginalDownloadCalls,
    resolveNextSetTrashMembership: (response) => pendingSetTrashMembership.shift()?.resolve(response),
    rejectNextSetTrashMembership: (error) => pendingSetTrashMembership.shift()?.reject(error),
    resolveNextRetryProcessing: (response) => pendingRetryProcessing.shift()?.resolve(response),
    rejectNextRetryProcessing: (error) => pendingRetryProcessing.shift()?.reject(error),
    resolveNextPresignOriginalDownload: (response) => pendingPresignOriginalDownload.shift()?.resolve(response),
    rejectNextPresignOriginalDownload: (error) => pendingPresignOriginalDownload.shift()?.reject(error),
  };
};
