import { permanentlyDeletePhoto } from "./permanent-deletion.js";
import type { PersonalAlbumStore } from "./store/personal-album.js";
import type { PhotoObjectStore } from "./store/photo-objects.js";

export const RETENTION_WINDOW_DAYS = 30;
const SWEEP_PAGE_SIZE = 100;

/** Sweeps every due Deleted Photo, including Photos belonging to inactive Users. */
export const sweepExpiredTrash = async ({
  store,
  photoObjects,
  now = new Date(),
}: {
  store: PersonalAlbumStore;
  photoObjects: PhotoObjectStore;
  now?: Date;
}): Promise<{ deletedCount: number }> => {
  const expiresAt = new Date(now.getTime() - RETENTION_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let cursor: string | undefined;
  let deletedCount = 0;

  do {
    const page = await store.queryExpiredTrashedPhotos({
      before: expiresAt,
      limit: SWEEP_PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
    });
    for (const { userId, photoId } of page.photos) {
      const result = await permanentlyDeletePhoto({
        album: store.personalAlbumOf(userId),
        photoObjects,
        photoId,
        expiresAt,
      });
      if (result === "deleted") deletedCount += 1;
    }
    cursor = page.nextCursor;
  } while (cursor);

  return { deletedCount };
};
