import type { Dimensions, TimelineThumbnailSources } from "@album/shared";

/** Equal actual widths collapse to the Large candidate (Section 3, Thumbnail access). */
export const buildTimelineThumbnailSources = (input: {
  small: { url: string; dimensions: Dimensions };
  large: { url: string; dimensions: Dimensions };
}): TimelineThumbnailSources =>
  input.small.dimensions.width === input.large.dimensions.width
    ? { large: input.large }
    : { large: input.large, small: input.small };
