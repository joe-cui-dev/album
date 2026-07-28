import type { EventBridgeHandler } from "aws-lambda";
import { sweepExpiredTrash } from "../trash-sweeper.js";
import { personalAlbumStore, photoObjectStore } from "../store/configured-store.js";

/** Daily scheduled enforcement of the Trash Retention Window. */
export const handler: EventBridgeHandler<"Scheduled Event", Record<string, never>, void> = async () => {
  await sweepExpiredTrash({ store: personalAlbumStore, photoObjects: photoObjectStore });
};
