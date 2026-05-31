# Add Timeline Thumbnails

Timeline browsing will use a separate Timeline Thumbnail derived from each Original Photo, with the longest edge limited to 320 pixels, while the existing Display Photo remains the larger derived image for detailed viewing. The photo processor will generate both derived images before marking a Photo ready, and the Timeline API will return temporary Timeline Thumbnail URLs directly so the web app can show the browsing grid without issuing one display-access request per photo.

This replaces the earlier first-version assumption that each Original Photo only needed one Display Photo. Shrinking the existing Display Photo would make detailed viewing worse, while lazy thumbnail generation would make the first Timeline browse slower and add partial-ready states that the MVP does not need.
