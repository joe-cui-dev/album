import { useEffect, useState } from "react";
import type { TimelineThumbnailSourcesV2 } from "@album/shared";

interface TimelineThumbnailImageProps {
  sources: TimelineThumbnailSourcesV2;
  width: number;
  height: number;
  fetchPriority: "high" | "auto" | "low";
  loading: "eager" | "lazy";
}

/**
 * Actual-width `srcset`/`sizes` responsive Timeline thumbnail with a one-time decode fade
 * (design doc "Thumbnail Loading"). On an actual load failure it shows a local placeholder --
 * no per-Photo Retry control -- and quietly tries again on its own once the Browsing Window's
 * access-renewal loop hands it a fresh source URL (implementation doc "Temporary-access
 * recovery"); until then the previous, still-usable source stays on screen.
 */
export function TimelineThumbnailImage({ sources, width, height, fetchPriority, loading }: TimelineThumbnailImageProps) {
  const [decoded, setDecoded] = useState(false);
  const [failed, setFailed] = useState(false);
  const src = sources.large.url;
  const srcSet = buildSrcSet(sources);

  // A fresh source URL (from a successful renewal) is a new attempt: clear a prior failure
  // and re-fade the decode-in rather than staying stuck on the placeholder.
  useEffect(() => {
    setFailed(false);
    setDecoded(false);
  }, [src]);

  if (failed) {
    return (
      <div
        aria-hidden="true"
        className="h-full w-full bg-stone-100"
        style={{ width, height }}
      />
    );
  }

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
      onError={() => setFailed(true)}
      onLoad={() => setDecoded(true)}
      sizes={`${Math.round(width)}px`}
      src={src}
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
