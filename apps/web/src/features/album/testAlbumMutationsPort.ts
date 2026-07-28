import type {
  TrashMembershipResponse,
  FavouriteMembershipResponse,
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

export interface SetFavouriteCall {
  photoId: string;
  favourite: boolean;
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
  setFavouriteCalls: SetFavouriteCall[];
  retryProcessingCalls: RetryProcessingCall[];
  presignOriginalDownloadCalls: PresignOriginalDownloadCall[];
  permanentlyDeletePhotoCalls: Array<{ photoId: string }>;
  emptyTrashCalls: number;
  resolveNextSetTrashMembership(response: TrashMembershipResponse): void;
  rejectNextSetTrashMembership(error: unknown): void;
  resolveNextSetFavourite(response: FavouriteMembershipResponse): void;
  rejectNextSetFavourite(error: unknown): void;
  resolveNextRetryProcessing(response: RetryProcessingResponse): void;
  rejectNextRetryProcessing(error: unknown): void;
  resolveNextPresignOriginalDownload(response: CreateTemporaryPhotoUrlResponse): void;
  rejectNextPresignOriginalDownload(error: unknown): void;
  resolveNextPermanentDeletion(): void;
  rejectNextPermanentDeletion(error: unknown): void;
  resolveNextEmptyTrash(): void;
  rejectNextEmptyTrash(error: unknown): void;
}

/** A fully controllable `albumMutations` port for deep-module tests: every call queues until the test resolves it. */
export const createTestAlbumMutationsPort = (): TestAlbumMutationsPort => {
  const setTrashMembershipCalls: SetTrashMembershipCall[] = [];
  const setFavouriteCalls: SetFavouriteCall[] = [];
  const retryProcessingCalls: RetryProcessingCall[] = [];
  const presignOriginalDownloadCalls: PresignOriginalDownloadCall[] = [];
  const pendingSetTrashMembership: Array<Deferred<TrashMembershipResponse>> = [];
  const pendingSetFavourite: Array<Deferred<FavouriteMembershipResponse>> = [];
  const pendingRetryProcessing: Array<Deferred<RetryProcessingResponse>> = [];
  const pendingPresignOriginalDownload: Array<Deferred<CreateTemporaryPhotoUrlResponse>> = [];
  const permanentlyDeletePhotoCalls: Array<{ photoId: string }> = [];
  const pendingPermanentDeletion: Array<Deferred<void>> = [];
  let emptyTrashCalls = 0;
  const pendingEmptyTrash: Array<Deferred<void>> = [];

  const port: AlbumMutationsPort = {
    setTrashMembership: ({ photoId, trashed, signal }) => {
      setTrashMembershipCalls.push({ photoId, trashed });
      return new Promise((resolve, reject) => {
        pendingSetTrashMembership.push({ resolve, reject });
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    },
    setFavourite: ({ photoId, favourite, signal }) => {
      setFavouriteCalls.push({ photoId, favourite });
      return new Promise((resolve, reject) => {
        pendingSetFavourite.push({ resolve, reject });
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
    permanentlyDeletePhoto: ({ photoId, signal }) => {
      permanentlyDeletePhotoCalls.push({ photoId });
      return new Promise((resolve, reject) => {
        pendingPermanentDeletion.push({ resolve, reject });
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    },
    emptyTrash: ({ signal }) => {
      emptyTrashCalls += 1;
      return new Promise((resolve, reject) => {
        pendingEmptyTrash.push({ resolve, reject });
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    },
  };

  return {
    port,
    setTrashMembershipCalls,
    setFavouriteCalls,
    retryProcessingCalls,
    presignOriginalDownloadCalls,
    permanentlyDeletePhotoCalls,
    get emptyTrashCalls() { return emptyTrashCalls; },
    resolveNextSetTrashMembership: (response) => pendingSetTrashMembership.shift()?.resolve(response),
    rejectNextSetTrashMembership: (error) => pendingSetTrashMembership.shift()?.reject(error),
    resolveNextSetFavourite: (response) => pendingSetFavourite.shift()?.resolve(response),
    rejectNextSetFavourite: (error) => pendingSetFavourite.shift()?.reject(error),
    resolveNextRetryProcessing: (response) => pendingRetryProcessing.shift()?.resolve(response),
    rejectNextRetryProcessing: (error) => pendingRetryProcessing.shift()?.reject(error),
    resolveNextPresignOriginalDownload: (response) => pendingPresignOriginalDownload.shift()?.resolve(response),
    rejectNextPresignOriginalDownload: (error) => pendingPresignOriginalDownload.shift()?.reject(error),
    resolveNextPermanentDeletion: () => pendingPermanentDeletion.shift()?.resolve(),
    rejectNextPermanentDeletion: (error) => pendingPermanentDeletion.shift()?.reject(error),
    resolveNextEmptyTrash: () => pendingEmptyTrash.shift()?.resolve(),
    rejectNextEmptyTrash: (error) => pendingEmptyTrash.shift()?.reject(error),
  };
};
