import type { PhotoCollection, ViewerBootstrapResponse } from "@album/shared";
import type { PhotoViewerPort } from "./photoViewerPort.js";

interface Deferred<T> {
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export interface BootstrapCall {
  photoId: string;
  collection?: PhotoCollection;
}

export interface TestPhotoViewerPort {
  port: PhotoViewerPort;
  calls: BootstrapCall[];
  resolveNextBootstrap(response: ViewerBootstrapResponse): void;
  rejectNextBootstrap(error: unknown): void;
}

/** A fully controllable PhotoViewer port for deep-module tests: every call queues until the test resolves it. */
export const createTestPhotoViewerPort = (): TestPhotoViewerPort => {
  const calls: BootstrapCall[] = [];
  const pending: Array<Deferred<ViewerBootstrapResponse>> = [];

  const port: PhotoViewerPort = {
    loadViewerBootstrap: ({ photoId, collection, signal }) => {
      calls.push({ photoId, ...(collection !== undefined ? { collection } : {}) });
      return new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    },
  };

  return {
    port,
    calls,
    resolveNextBootstrap: (response) => pending.shift()?.resolve(response),
    rejectNextBootstrap: (error) => pending.shift()?.reject(error),
  };
};
