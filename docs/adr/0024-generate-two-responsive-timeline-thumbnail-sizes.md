# Generate Two Responsive Timeline Thumbnail Sizes

Photo processing will produce Small and Large Timeline Thumbnails with target long edges of approximately 320 and 640 pixels. The Timeline will expose both private variants through responsive image sources, while the Photo Viewer will continue to use the separate Display Photo.

One 320-pixel thumbnail is visibly soft in wide Justified Rows and on high-density displays, while using Display Photos would waste bandwidth during continuous browsing. Two variants provide a deliberate mobile/desktop balance without multiplying storage and migration cost across many responsive sizes; existing Ready Photos may receive the Large variant through background or on-demand backfill.
