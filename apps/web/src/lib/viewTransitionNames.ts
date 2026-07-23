/** Shared `view-transition-name` pairing one Timeline thumbnail with the Photo Viewer's opening
 * image (design doc "Photographic Signature": Viewer's opening transition). `BrowsingGrid`'s
 * `PhotoLink` only ever applies it to the single Link `useViewTransitionState` reports as
 * currently opening the Viewer, so at most one element in the document carries it at a time. */
export const PHOTO_VIEW_TRANSITION_NAME = "photo-thumb";
