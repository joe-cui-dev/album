import type { PhotoCollection } from "./store/personal-album.js";

const CURSOR_VERSION = 1;

export interface TimelineCursor {
  v: typeof CURSOR_VERSION;
  collection: PhotoCollection;
  /** The last projection sort key of the previous page; the next page resumes strictly after it. */
  after: string;
}

/** Opaque, versioned, collection-scoped continuation token. Callers never construct or parse the sort key themselves. */
export const encodeTimelineCursor = (cursor: Omit<TimelineCursor, "v">): string =>
  Buffer.from(JSON.stringify({ v: CURSOR_VERSION, ...cursor }), "utf8").toString("base64url");

export const decodeTimelineCursor = (
  value: string,
  expectedCollection: PhotoCollection,
): TimelineCursor | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  if (
    record.v !== CURSOR_VERSION ||
    record.collection !== expectedCollection ||
    typeof record.after !== "string"
  ) {
    return undefined;
  }
  return { v: CURSOR_VERSION, collection: expectedCollection, after: record.after };
};
