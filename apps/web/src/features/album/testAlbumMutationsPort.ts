import type {
  ArchiveMembershipResponse,
  CreateTemporaryPhotoUrlResponse,
  RetryProcessingResponse,
} from "@album/shared";
import type { AlbumMutationsPort } from "./albumMutationsPort.js";

interface Deferred<T> {
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export interface SetArchiveMembershipCall {
  photoId: string;
  archived: boolean;
}

export interface RetryProcessingCall {
  photoId: string;
}

export interface PresignOriginalDownloadCall {
  photoId: string;
}

export interface TestAlbumMutationsPort {
  port: AlbumMutationsPort;
  setArchiveMembershipCalls: SetArchiveMembershipCall[];
  retryProcessingCalls: RetryProcessingCall[];
  presignOriginalDownloadCalls: PresignOriginalDownloadCall[];
  resolveNextSetArchiveMembership(response: ArchiveMembershipResponse): void;
  rejectNextSetArchiveMembership(error: unknown): void;
  resolveNextRetryProcessing(response: RetryProcessingResponse): void;
  rejectNextRetryProcessing(error: unknown): void;
  resolveNextPresignOriginalDownload(response: CreateTemporaryPhotoUrlResponse): void;
  rejectNextPresignOriginalDownload(error: unknown): void;
}

/** A fully controllable `albumMutations` port for deep-module tests: every call queues until the test resolves it. */
export const createTestAlbumMutationsPort = (): TestAlbumMutationsPort => {
  const setArchiveMembershipCalls: SetArchiveMembershipCall[] = [];
  const retryProcessingCalls: RetryProcessingCall[] = [];
  const presignOriginalDownloadCalls: PresignOriginalDownloadCall[] = [];
  const pendingSetArchiveMembership: Array<Deferred<ArchiveMembershipResponse>> = [];
  const pendingRetryProcessing: Array<Deferred<RetryProcessingResponse>> = [];
  const pendingPresignOriginalDownload: Array<Deferred<CreateTemporaryPhotoUrlResponse>> = [];

  const port: AlbumMutationsPort = {
    setArchiveMembership: ({ photoId, archived, signal }) => {
      setArchiveMembershipCalls.push({ photoId, archived });
      return new Promise((resolve, reject) => {
        pendingSetArchiveMembership.push({ resolve, reject });
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
    setArchiveMembershipCalls,
    retryProcessingCalls,
    presignOriginalDownloadCalls,
    resolveNextSetArchiveMembership: (response) => pendingSetArchiveMembership.shift()?.resolve(response),
    rejectNextSetArchiveMembership: (error) => pendingSetArchiveMembership.shift()?.reject(error),
    resolveNextRetryProcessing: (response) => pendingRetryProcessing.shift()?.resolve(response),
    rejectNextRetryProcessing: (error) => pendingRetryProcessing.shift()?.reject(error),
    resolveNextPresignOriginalDownload: (response) => pendingPresignOriginalDownload.shift()?.resolve(response),
    rejectNextPresignOriginalDownload: (error) => pendingPresignOriginalDownload.shift()?.reject(error),
  };
};
