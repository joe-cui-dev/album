import { useEffect, useState } from "react";
import type { TimelineThumbnailSources } from "@album/shared";
import type { ThumbnailOutcomeObservation } from "./browsingWindow.js";

interface TimelineThumbnailImageProps {
  photoId: string;
  /** The lease revision this exact `sources` was granted for -- reported back unchanged on outcome. */
  leaseRevision: number;
  sources: TimelineThumbnailSources;
  width: number;
  height: number;
  fetchPriority: "high" | "auto" | "low";
  loading: "eager" | "lazy";
  /** Set only on the one thumbnail whose Link is opening the Viewer, to pair with its `view-transition-name`
   * (design doc "Photographic Signature"). Browsers without View Transitions ignore it. */
  viewTransitionName?: string;
  /** Reports the outcome to the Browsing Window; recovery (renewal, retry, terminal placeholder) is its call, not this component's (ADR-0051). */
  onOutcome: (observation: ThumbnailOutcomeObservation) => void;
}

/**
 * Actual-width `srcset`/`sizes` responsive Timeline thumbnail with a one-time decode fade (design
 * doc "Thumbnail Loading"). Decode/fade state is local and cosmetic; on an actual load failure it
 * hides the broken image and reports the outcome, without deciding whether or how to recover --
 * a fresh `leaseRevision` (a successful renewal) clears the local failure and re-fades the
 * decode-in on its own.
 */
export function TimelineThumbnailImage({
  photoId,
  leaseRevision,
  sources,
  width,
  height,
  fetchPriority,
  loading,
  viewTransitionName,
  onOutcome,
}: TimelineThumbnailImageProps) {
  const [decoded, setDecoded] = useState(false);
  const [failed, setFailed] = useState(false);
  const src = sources.large.url;
  const srcSet = buildSrcSet(sources);

  // A new lease revision is a fresh attempt: clear a prior failure and re-fade the decode-in
  // rather than staying stuck on the local placeholder.
  useEffect(() => {
    setFailed(false);
    setDecoded(false);
  }, [leaseRevision]);

  if (failed) {
    return (
      <div
        aria-hidden="true"
        className="h-full w-full bg-table-glow"
        style={{ width, height }}
      />
    );
  }

  return (
    <img
      alt=""
      className={`h-full w-full bg-table-glow object-cover transition-opacity motion-reduce:transition-none ${
        decoded ? "opacity-100" : "opacity-0"
      }`}
      decoding="async"
      fetchPriority={fetchPriority}
      height={height}
      loading={loading}
      onError={() => {
        setFailed(true);
        onOutcome({ photoId, leaseRevision, outcome: "failed" });
      }}
      onLoad={() => {
        setDecoded(true);
        onOutcome({ photoId, leaseRevision, outcome: "loaded" });
      }}
      sizes={`${Math.round(width)}px`}
      src={src}
      srcSet={srcSet}
      style={{ transitionDuration: "140ms", ...(viewTransitionName !== undefined ? { viewTransitionName } : {}) }}
      width={width}
    />
  );
}

const buildSrcSet = (sources: TimelineThumbnailSources): string => {
  const entries = [sources.small, sources.large].filter(
    (source): source is TimelineThumbnailSources["large"] => source !== undefined,
  );
  return entries.map((source) => `${source.url} ${source.dimensions.width}w`).join(", ");
};
