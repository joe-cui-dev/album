import type { CapturedAt, CapturedAtAdjustmentResponse, ViewerBootstrapResponse } from "@album/shared";
import { albumTransport } from "../../lib/albumTransport.js";

/** Network boundary owned by the Captured At editor. */
export interface CapturedAtEditorPort {
  adjust(input: { photoId: string; capturedAt: CapturedAt; revision: number; signal: AbortSignal }): Promise<CapturedAtAdjustmentResponse>;
  revert(input: { photoId: string; revision: number; signal: AbortSignal }): Promise<CapturedAtAdjustmentResponse>;
  loadLatest(input: { photoId: string; collection: "active" | "archived"; signal: AbortSignal }): Promise<ViewerBootstrapResponse>;
}

export const createHttpCapturedAtEditorPort = (): CapturedAtEditorPort => ({
  adjust: ({ photoId, capturedAt, revision, signal }) =>
    albumTransport.request(`/photos/${photoId}/captured-at-adjustment`, {
      method: "PUT",
      body: { capturedAt },
      headers: { "If-Match": `\"${revision}\"` },
      signal,
    }),
  revert: ({ photoId, revision, signal }) =>
    albumTransport.request(`/photos/${photoId}/captured-at-adjustment`, {
      method: "DELETE",
      headers: { "If-Match": `\"${revision}\"` },
      signal,
    }),
  loadLatest: ({ photoId, collection, signal }) =>
    albumTransport.request(`/photos/${photoId}/viewer?collection=${collection}`, { signal }),
});
