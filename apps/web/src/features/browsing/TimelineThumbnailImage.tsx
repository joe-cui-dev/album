import { useState } from "react";
import type { TimelineThumbnailSourcesV2 } from "@album/shared";

interface TimelineThumbnailImageProps {
  sources: TimelineThumbnailSourcesV2;
  width: number;
  height: number;
  fetchPriority: "high" | "auto" | "low";
  loading: "eager" | "lazy";
  onError?: () => void;
}

/** Actual-width `srcset`/`sizes` responsive Timeline thumbnail with a one-time decode fade (design doc "Thumbnail Loading"). */
export function TimelineThumbnailImage({
  sources,
  width,
  height,
  fetchPriority,
  loading,
  onError,
}: TimelineThumbnailImageProps) {
  const [decoded, setDecoded] = useState(false);
  const srcSet = buildSrcSet(sources);

  return (
    <img
      alt=""
      className={`h-full w-full bg-stone-100 object-cover transition-opacity motion-reduce:transition-none ${
        decoded ? "opacity-100" : "opacity-0"
      }`}
      decoding="async"
      fetchPriority={fetchPriority}
      height={height}
      loading={loading}
      onError={onError}
      onLoad={() => setDecoded(true)}
      sizes={`${Math.round(width)}px`}
      src={sources.large.url}
      srcSet={srcSet}
      style={{ transitionDuration: "140ms" }}
      width={width}
    />
  );
}

const buildSrcSet = (sources: TimelineThumbnailSourcesV2): string => {
  const entries = [sources.small, sources.large].filter(
    (source): source is TimelineThumbnailSourcesV2["large"] => source !== undefined,
  );
  return entries.map((source) => `${source.url} ${source.dimensions.width}w`).join(", ");
};
