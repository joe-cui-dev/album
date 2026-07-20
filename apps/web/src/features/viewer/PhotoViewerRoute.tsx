import { useEffect, useRef } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import type { PhotoCollection } from "@album/shared";
import { PhotoViewerDarkroom } from "./PhotoViewerDarkroom.js";
import { createPhotoViewer, type PhotoViewer, type SequencePosition } from "./photoViewer.js";
import { createHttpPhotoViewerPort } from "./photoViewerPort.js";

interface PhotoViewerRouteProps {
  /** "contextual" keeps the originating Timeline/Archive route mounted and inert beneath a modal layer (ADR-0063); "direct" is a standalone page. */
  mode: "contextual" | "direct";
}

interface LocationState {
  background?: unknown;
  sequencePosition?: SequencePosition;
  /** Only present for a contextual open; a direct load always infers the current collection (implementation doc "Direct route"). */
  sourceCollection?: PhotoCollection;
}

export function PhotoViewerRoute({ mode }: PhotoViewerRouteProps) {
  const { photoId } = useParams<{ photoId: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const state = (location.state ?? undefined) as LocationState | undefined;
  const sourceCollection = state?.sourceCollection;

  const viewerRef = useRef<{ photoId: string; viewer: PhotoViewer } | undefined>(undefined);
  if (photoId !== undefined && (!viewerRef.current || viewerRef.current.photoId !== photoId)) {
    viewerRef.current?.viewer.dispose();
    viewerRef.current = {
      photoId,
      viewer: createPhotoViewer({
        photoId,
        port: createHttpPhotoViewerPort(),
        ...(sourceCollection !== undefined ? { sourceCollection } : {}),
        ...(state?.sequencePosition !== undefined ? { initialSequencePosition: state.sequencePosition } : {}),
      }),
    };
  }

  useEffect(() => () => viewerRef.current?.viewer.dispose(), []);

  if (photoId === undefined || !viewerRef.current) {
    return null;
  }

  const handleClose = (): void => {
    if (mode === "contextual") {
      navigate(-1);
      return;
    }
    const resolvedCollection = viewerRef.current?.viewer.getCurrentCollection() ?? sourceCollection;
    // Tells the destination Timeline/Archive page to focus its main heading, matching Close's standalone-page contract.
    navigate(resolvedCollection === "archived" ? "/album/archive" : "/album", {
      state: { focusMainHeading: true },
    });
  };

  return <PhotoViewerDarkroom mode={mode} onClose={handleClose} viewer={viewerRef.current.viewer} />;
}
