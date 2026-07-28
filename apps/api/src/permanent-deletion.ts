import type { PersonalAlbum } from "./store/personal-album.js";
import type { PhotoObjectStore } from "./store/photo-objects.js";
import { randomUUID } from "node:crypto";

export type PermanentDeletionResult = "deleted" | "missing" | "ineligible" | "notDue";

/**
 * The one deletion module used by an explicit Permanent Deletion and the
 * retention sweep. It deliberately removes recoverable object data before
 * atomically removing the metadata that can lead us back to it.
 */
export const permanentlyDeletePhoto = async ({
  album,
  photoObjects,
  photoId,
  expiresAt,
}: {
  album: PersonalAlbum;
  photoObjects: PhotoObjectStore;
  photoId: string;
  /** When present, only a Deleted Photo at or before this time may be removed. */
  expiresAt?: string;
}): Promise<PermanentDeletionResult> => {
  const photo = await album.getPhoto(photoId);
  if (!photo) return "missing";

  const readyDeleted = photo.processingState === "ready" && photo.trashed;
  const failed = photo.processingState === "processingFailed";
  if (!readyDeleted && !failed) return "ineligible";
  if (expiresAt !== undefined && (!readyDeleted || !photo.deletedAt || photo.deletedAt > expiresAt)) {
    return "notDue";
  }

  const objectKeys = [
    photo.originalObjectKey,
    photo.displayObjectKey,
    photo.timelineThumbnails?.small.objectKey,
    photo.timelineThumbnails?.large.objectKey,
  ].filter((key): key is string => typeof key === "string");
  const reservationId = randomUUID();
  const reserved = await album.reservePermanentDeletion({ photo, reservationId });
  if (!reserved) return "missing";
  await photoObjects.deleteObjects(objectKeys);
  await album.permanentlyDeletePhoto({ photo, reservationId });
  return "deleted";
};
