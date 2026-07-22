import type { CapturedAtSource } from "@album/shared";

/** One User-facing vocabulary for provenance in Viewer and chronology flows. */
export const capturedAtSourceLabel = (source: CapturedAtSource): string => {
  switch (source) {
    case "exif":
      return "Date from photo";
    case "fileModifiedTime":
      return "Date from file";
    case "uploadTime":
      return "Date from upload";
    case "userAdjusted":
      return "Adjusted by you";
  }
};
