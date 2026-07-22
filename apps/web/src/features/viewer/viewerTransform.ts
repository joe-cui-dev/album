export interface Size { width: number; height: number }
export interface Point { x: number; y: number }
export interface ViewerTransform { photo: Size; viewport: Size; scale: number; pan: Point }

const intrinsicCeiling = 1;

export const fitScale = (photo: Size, viewport: Size): number =>
  Math.min(intrinsicCeiling, viewport.width / photo.width, viewport.height / photo.height);

export const createViewerTransform = (photo: Size, viewport: Size): ViewerTransform => ({
  photo,
  viewport,
  scale: fitScale(photo, viewport),
  pan: { x: 0, y: 0 },
});

const limits = (transform: Pick<ViewerTransform, "photo" | "viewport" | "scale">): Point => ({
  x: Math.max(0, (transform.photo.width * transform.scale - transform.viewport.width) / 2),
  y: Math.max(0, (transform.photo.height * transform.scale - transform.viewport.height) / 2),
});

const baseOffset = (photo: Size, viewport: Size, scale: number): Point => ({
  x: (viewport.width - photo.width * scale) / 2,
  y: (viewport.height - photo.height * scale) / 2,
});

export const constrainPan = (transform: Pick<ViewerTransform, "photo" | "viewport" | "scale">, pan: Point): Point => {
  const bound = limits(transform);
  const clamp = (value: number, limit: number): number => limit === 0 ? 0 : Math.max(-limit, Math.min(limit, value));
  return {
    x: clamp(pan.x, bound.x),
    y: clamp(pan.y, bound.y),
  };
};

export const panBy = (transform: ViewerTransform, delta: Point): ViewerTransform => ({
  ...transform,
  pan: constrainPan(transform, { x: transform.pan.x + delta.x, y: transform.pan.y + delta.y }),
});

/** Changes scale around a viewport point without ever exceeding the Display Photo's own pixels. */
export const scaleAroundPoint = (transform: ViewerTransform, requestedScale: number, point: Point): ViewerTransform => {
  const scale = Math.max(fitScale(transform.photo, transform.viewport), Math.min(intrinsicCeiling, requestedScale));
  const oldBase = baseOffset(transform.photo, transform.viewport, transform.scale);
  const newBase = baseOffset(transform.photo, transform.viewport, scale);
  const focal = { x: (point.x - oldBase.x - transform.pan.x) / transform.scale, y: (point.y - oldBase.y - transform.pan.y) / transform.scale };
  const next = {
    ...transform,
    scale,
    pan: {
      x: point.x - newBase.x - focal.x * scale,
      y: point.y - newBase.y - focal.y * scale,
    },
  };
  return { ...next, pan: constrainPan(next, next.pan) };
};

/** Retains the Photo point currently under viewport centre as far as new bounds permit. */
export const resizeTransform = (transform: ViewerTransform, viewport: Size): ViewerTransform => {
  const oldCentre = { x: transform.viewport.width / 2, y: transform.viewport.height / 2 };
  const oldBase = baseOffset(transform.photo, transform.viewport, transform.scale);
  const focal = { x: (oldCentre.x - oldBase.x - transform.pan.x) / transform.scale, y: (oldCentre.y - oldBase.y - transform.pan.y) / transform.scale };
  const scale = Math.max(fitScale(transform.photo, viewport), transform.scale);
  const centre = { x: viewport.width / 2, y: viewport.height / 2 };
  const base = baseOffset(transform.photo, viewport, scale);
  const next = { ...transform, viewport, scale, pan: { x: centre.x - base.x - focal.x * scale, y: centre.y - base.y - focal.y * scale } };
  return { ...next, pan: constrainPan(next, next.pan) };
};

export const resetForPhoto = (transform: ViewerTransform, photo: Size): ViewerTransform => createViewerTransform(photo, transform.viewport);

export const isAtFit = (transform: ViewerTransform): boolean => Math.abs(transform.scale - fitScale(transform.photo, transform.viewport)) < 0.0001;
