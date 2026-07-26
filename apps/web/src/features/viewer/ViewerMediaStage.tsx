import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { ViewerBootstrapResponse } from "@album/shared";
import { PHOTO_VIEW_TRANSITION_NAME } from "../../lib/viewTransitionNames.js";
import type { PhotoViewer } from "./photoViewer.js";
import { createViewerGestureController } from "./viewerGesture.js";
import { createViewerTransform, isAtFit, panBy, resetForPhoto, resizeTransform, scaleAroundPoint, type ViewerTransform } from "./viewerTransform.js";

interface Props { bootstrap: ViewerBootstrapResponse | undefined; isLoading: boolean; loadError: string | undefined; viewer: PhotoViewer; chromeVisible: boolean; onActivity(): void; onGesture(active: boolean): void; onToggleChrome(): void; children?: ReactNode }

/** Owns the image box, transform state, and Pointer Events; viewer chrome remains outside this stable layout box. */
export function ViewerMediaStage({ bootstrap, isLoading, loadError, viewer, chromeVisible, onActivity, onGesture, onToggleChrome, children }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<ViewerTransform | undefined>(undefined);
  const [transform, setTransform] = useState<ViewerTransform>();
  const [displayFailed, setDisplayFailed] = useState(false);
  const [showLoading, setShowLoading] = useState(false);
  const refreshedPhotoRef = useRef<string | undefined>(undefined);
  const controllerRef = useRef<ReturnType<typeof createViewerGestureController> | undefined>(undefined);

  const update = (next: ViewerTransform) => { transformRef.current = next; setTransform(next); };
  useLayoutEffect(() => {
    if (!bootstrap || !stageRef.current) return;
    const box = stageRef.current.getBoundingClientRect();
    const next = createViewerTransform(bootstrap.displayDimensions, { width: box.width, height: box.height });
    update(next); setDisplayFailed(false); refreshedPhotoRef.current = undefined;
  }, [bootstrap?.photoId, bootstrap?.displayDimensions.width, bootstrap?.displayDimensions.height]);

  useEffect(() => {
    const onResize = () => { if (transformRef.current && stageRef.current) { const box = stageRef.current.getBoundingClientRect(); update(resizeTransform(transformRef.current, { width: box.width, height: box.height })); } };
    window.addEventListener("resize", onResize); return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => {
    if (!isLoading) { setShowLoading(false); return; }
    const timer = window.setTimeout(() => setShowLoading(true), 500);
    return () => window.clearTimeout(timer);
  }, [isLoading]);

  const gesture = () => controllerRef.current ??= createViewerGestureController({
    viewportWidth: () => stageRef.current?.clientWidth ?? 0,
    isAtFit: () => !transformRef.current || isAtFit(transformRef.current),
    onNext: () => viewer.intents.showNext(), onPrevious: () => viewer.intents.showPrevious(),
    onPan: (delta) => { if (transformRef.current) update(panBy(transformRef.current, delta)); },
    onPinch: (point, ratio) => { if (transformRef.current) update(scaleAroundPoint(transformRef.current, transformRef.current.scale * ratio, point)); },
    onActiveChange: onGesture, onTap: onToggleChrome,
  });
  useEffect(() => () => controllerRef.current?.dispose(), []);

  const atFit = !transform || isAtFit(transform);
  const zoom = () => { if (!transform) return; update(atFit ? scaleAroundPoint(transform, 1, { x: transform.viewport.width / 2, y: transform.viewport.height / 2 }) : resetForPhoto(transform, transform.photo)); onActivity(); };
  // Always paired with the one Timeline thumbnail Link mid-transition into this route
  // (`BrowsingGrid`'s `PhotoLink`); harmless outside an active View Transition, and Prev/Next
  // never triggers one, so a stale name here can never collide with a second snapshot target.
  const imageStyle = transform ? { transform: `translate(${transform.pan.x}px, ${transform.pan.y}px) scale(${transform.scale})`, transformOrigin: "center", maxWidth: "none", maxHeight: "none", width: transform.photo.width, height: transform.photo.height, viewTransitionName: PHOTO_VIEW_TRANSITION_NAME } : undefined;
  const handleError = () => {
    if (!bootstrap) return;
    // Test and development fixtures use an in-memory data URL; it has no expiring
    // Display Access capability and therefore is never an access-expiry signal.
    if (bootstrap.displayAccess.url.startsWith("data:")) return;
    if (refreshedPhotoRef.current !== bootstrap.photoId) { refreshedPhotoRef.current = bootstrap.photoId; viewer.intents.refresh(); return; }
    setDisplayFailed(true);
  };
  return <div className="viewer-media-stage relative flex flex-1 touch-none items-center justify-center overflow-hidden" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); onActivity(); gesture().pointerDown(event.nativeEvent); }} onPointerMove={(event) => { onActivity(); gesture().pointerMove(event.nativeEvent); }} onPointerUp={(event) => gesture().pointerUp(event.nativeEvent)} onPointerCancel={() => gesture().pointerCancel()} ref={stageRef}>
    {loadError || displayFailed ? <p className="flex flex-col items-center gap-3 text-center" role="alert">Couldn&apos;t load this photo.<button className="underline" onClick={() => { setDisplayFailed(false); viewer.intents.retry(); }} onPointerDown={(event) => event.stopPropagation()} type="button">Retry</button></p>
      : isLoading || !bootstrap ? (showLoading ? <p role="status">Loading photo…</p> : null)
      : <img alt={bootstrap.fileName} className="select-none object-contain" draggable={false} onError={handleError} onLoad={() => viewer.intents.notifyDisplayDecoded()} src={bootstrap.displayAccess.url} style={imageStyle} />}
    {children}
    {bootstrap ? <button aria-label={atFit ? (transform?.scale === 1 ? "Photo is already at 100%" : "View at 100%") : "Fit to screen"} className={`absolute bottom-3 right-3 inline-flex h-11 min-w-11 items-center justify-center rounded-full bg-black/50 px-3 text-sm ${chromeVisible ? "" : "pointer-events-none opacity-0"}`} disabled={atFit && transform?.scale === 1} onClick={zoom} onPointerDown={(event) => event.stopPropagation()} type="button">{atFit ? "100%" : "Fit"}</button> : null}
  </div>;
}
