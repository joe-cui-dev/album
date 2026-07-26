import type { JustifiedLayoutItem } from "./justifiedRows.js";

/**
 * A captured content anchor (ADR-0054): the first substantially visible Photo and its row's
 * offset from the content viewport, or a period anchor when a month marker owns the top
 * position. `olderPhotoId`/`newerPhotoId` are the anchor Photo's immediate neighbours at capture
 * time (in descriptor/newest-first order), remembered so a mutation that removes the anchor Photo
 * can still fall back without losing the reader's place.
 */
export type CapturedAnchor =
  | { kind: "photo"; photoId: string; rowOffset: number; periodKey: string; olderPhotoId?: string; newerPhotoId?: string }
  | { kind: "period"; periodKey: string };

/** ADR-0054: a library-neutral restoration directive with a monotonically increasing revision. */
export interface RestorationDirective {
  revision: number;
  kind: "photo" | "period";
  photoId?: string;
  periodKey?: string;
  rowOffset: number;
}

/** Captures the anchor for the layout item at `itemIndex`, using `descriptorOrder` for fallback neighbours. */
export const captureAnchor = (
  layoutItems: readonly JustifiedLayoutItem[],
  itemIndex: number,
  rowOffset: number,
  descriptorOrder: readonly string[],
): CapturedAnchor | undefined => {
  const item = layoutItems[itemIndex];
  if (!item) {
    return undefined;
  }
  if (item.kind === "month-marker") {
    return { kind: "period", periodKey: item.periodKey };
  }
  const photoId = item.photoIds[0];
  if (photoId === undefined) {
    return undefined;
  }
  const index = descriptorOrder.indexOf(photoId);
  // Newest-first order: the next entry is chronologically older, the previous one newer.
  const olderPhotoId = index === -1 ? undefined : descriptorOrder[index + 1];
  const newerPhotoId = index > 0 ? descriptorOrder[index - 1] : undefined;
  return {
    kind: "photo",
    photoId,
    rowOffset,
    periodKey: item.periodKey,
    ...(olderPhotoId !== undefined ? { olderPhotoId } : {}),
    ...(newerPhotoId !== undefined ? { newerPhotoId } : {}),
  };
};

export interface ResolvedAnchor {
  itemIndex: number;
  rowOffset: number;
  kind: "photo" | "period";
  photoId?: string;
  periodKey?: string;
}

const findRowIndex = (layoutItems: readonly JustifiedLayoutItem[], photoId: string | undefined): number | undefined => {
  if (photoId === undefined) {
    return undefined;
  }
  const index = layoutItems.findIndex((item) => item.kind === "row" && item.photoIds.includes(photoId));
  return index === -1 ? undefined : index;
};

/**
 * Resolves a captured anchor against current layout, following ADR-0054's fallback order: the
 * anchor Photo, then its remembered older neighbour, then its remembered newer neighbour, then
 * its period marker. Returns `undefined` only when none of those exist in the current layout.
 */
export const resolveAnchor = (layoutItems: readonly JustifiedLayoutItem[], anchor: CapturedAnchor): ResolvedAnchor | undefined => {
  if (anchor.kind === "period") {
    const index = layoutItems.findIndex((item) => item.kind === "month-marker" && item.periodKey === anchor.periodKey);
    return index === -1 ? undefined : { itemIndex: index, rowOffset: 0, kind: "period", periodKey: anchor.periodKey };
  }

  const directIndex = findRowIndex(layoutItems, anchor.photoId);
  if (directIndex !== undefined) {
    return { itemIndex: directIndex, rowOffset: anchor.rowOffset, kind: "photo", photoId: anchor.photoId };
  }
  const olderIndex = findRowIndex(layoutItems, anchor.olderPhotoId);
  if (olderIndex !== undefined && anchor.olderPhotoId !== undefined) {
    return { itemIndex: olderIndex, rowOffset: anchor.rowOffset, kind: "photo", photoId: anchor.olderPhotoId };
  }
  const newerIndex = findRowIndex(layoutItems, anchor.newerPhotoId);
  if (newerIndex !== undefined && anchor.newerPhotoId !== undefined) {
    return { itemIndex: newerIndex, rowOffset: anchor.rowOffset, kind: "photo", photoId: anchor.newerPhotoId };
  }
  const periodIndex = layoutItems.findIndex((item) => item.kind === "month-marker" && item.periodKey === anchor.periodKey);
  return periodIndex === -1 ? undefined : { itemIndex: periodIndex, rowOffset: 0, kind: "period", periodKey: anchor.periodKey };
};
