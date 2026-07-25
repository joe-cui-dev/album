import type { ListCollectionPhotosResponse, PhotoCollection } from "@album/shared";
import { AlbumTransportError } from "../../lib/albumTransport.js";
import type { AlbumBrowsingPort } from "./albumBrowsingPort.js";

export type DateJumpResult =
  | { outcome: "committed"; page: ListCollectionPhotosResponse }
  | { outcome: "empty_period" }
  | { outcome: "cancelled" }
  | { outcome: "failed" };

/**
 * ADR-0058: probes the candidate anchor before committing anything. The
 * current Browsing Window and URL are left untouched unless the probe
 * succeeds; the caller navigates only on `"committed"`. The committed page
 * is handed back so the caller can seed the new Browsing Window with it
 * directly instead of re-fetching the same anchor a second time.
 */
export const probeDateJump = async ({
  collection,
  targetAnchor,
  port,
  signal,
}: {
  collection: PhotoCollection;
  targetAnchor: string;
  port: AlbumBrowsingPort;
  signal: AbortSignal;
}): Promise<DateJumpResult> => {
  try {
    const page = await port.loadCollectionPage({ collection, startAt: targetAnchor, signal });
    return { outcome: "committed", page };
  } catch (error) {
    if (error instanceof AlbumTransportError) {
      if (error.code === "cancelled") {
        return { outcome: "cancelled" };
      }
      if (error.code === "empty_period") {
        return { outcome: "empty_period" };
      }
    }
    return { outcome: "failed" };
  }
};
