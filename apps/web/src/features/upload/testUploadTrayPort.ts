import type { CreateUploadBatchRequest, CreateUploadBatchResponse, GetUploadBatchStatusResponse } from "@album/shared";
import type { DateJumpResult } from "../browsing/dateJump.js";
import type { UploadTrayPort } from "./uploadTrayPort.js";

interface Deferred<T> {
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export interface CreateUploadBatchCall {
  files: CreateUploadBatchRequest["files"];
  uploadContext: CreateUploadBatchRequest["uploadContext"];
}

export interface UploadFileCall {
  file: File;
  uploadUrl: string;
}

export interface TestUploadTrayPort {
  port: UploadTrayPort;
  createUploadBatchCalls: CreateUploadBatchCall[];
  getUploadBatchStatusCalls: string[];
  uploadFileCalls: UploadFileCall[];
  probeDateJumpCalls: string[];
  /** Currently in-flight `uploadFile` calls, in call order -- for asserting bounded concurrency. */
  inFlightUploadFileCount(): number;
  resolveNextCreateUploadBatch(response: CreateUploadBatchResponse): void;
  rejectNextCreateUploadBatch(error: unknown): void;
  resolveNextGetUploadBatchStatus(response: GetUploadBatchStatusResponse): void;
  rejectNextGetUploadBatchStatus(error: unknown): void;
  /** Resolves the oldest still-pending `uploadFile` call (FIFO across whichever files are currently in flight). */
  resolveNextUploadFile(): void;
  rejectNextUploadFile(error: unknown): void;
  resolveNextProbeDateJump(result: DateJumpResult): void;
}

/** A fully controllable `uploadTray` port for deep-module tests: every call queues until the test resolves it. */
export const createTestUploadTrayPort = (): TestUploadTrayPort => {
  const createUploadBatchCalls: CreateUploadBatchCall[] = [];
  const getUploadBatchStatusCalls: string[] = [];
  const uploadFileCalls: UploadFileCall[] = [];
  const probeDateJumpCalls: string[] = [];

  const pendingCreateUploadBatch: Array<Deferred<CreateUploadBatchResponse>> = [];
  const pendingGetUploadBatchStatus: Array<Deferred<GetUploadBatchStatusResponse>> = [];
  const pendingUploadFile: Array<Deferred<void>> = [];
  const pendingProbeDateJump: Array<Deferred<DateJumpResult>> = [];

  const port: UploadTrayPort = {
    createUploadBatch: ({ files, uploadContext, signal }) => {
      createUploadBatchCalls.push({ files, uploadContext });
      return new Promise((resolve, reject) => {
        pendingCreateUploadBatch.push({ resolve, reject });
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    },
    getUploadBatchStatus: ({ uploadBatchId, signal }) => {
      getUploadBatchStatusCalls.push(uploadBatchId);
      return new Promise((resolve, reject) => {
        pendingGetUploadBatchStatus.push({ resolve, reject });
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    },
    uploadFile: ({ file, uploadUrl, signal }) => {
      uploadFileCalls.push({ file, uploadUrl });
      return new Promise((resolve, reject) => {
        pendingUploadFile.push({ resolve, reject });
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    },
    probeDateJump: ({ targetAnchor, signal }) => {
      probeDateJumpCalls.push(targetAnchor);
      return new Promise((resolve, reject) => {
        pendingProbeDateJump.push({ resolve, reject });
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    },
  };

  return {
    port,
    createUploadBatchCalls,
    getUploadBatchStatusCalls,
    uploadFileCalls,
    probeDateJumpCalls,
    inFlightUploadFileCount: () => pendingUploadFile.length,
    resolveNextCreateUploadBatch: (response) => pendingCreateUploadBatch.shift()?.resolve(response),
    rejectNextCreateUploadBatch: (error) => pendingCreateUploadBatch.shift()?.reject(error),
    resolveNextGetUploadBatchStatus: (response) => pendingGetUploadBatchStatus.shift()?.resolve(response),
    rejectNextGetUploadBatchStatus: (error) => pendingGetUploadBatchStatus.shift()?.reject(error),
    resolveNextUploadFile: () => pendingUploadFile.shift()?.resolve(),
    rejectNextUploadFile: (error) => pendingUploadFile.shift()?.reject(error),
    resolveNextProbeDateJump: (result) => pendingProbeDateJump.shift()?.resolve(result),
  };
};
