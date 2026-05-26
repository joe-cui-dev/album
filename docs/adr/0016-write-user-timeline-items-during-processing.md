# Write User Timeline Items During Processing

The processor will write Timeline query items when a Photo receives its Captured At value, keyed by User ID and Captured At rather than by a global timeline. This lets Phase 6 query each User's Personal Album directly and avoids adding scans or a later migration after Phase 5 has already processed photos.

Each Photo's canonical item will also live inside the owning User's partition, keyed from the authenticated session for API calls such as detail, archive, retry, Display Access, and Original Download. The first version will not use a global `PHOTO#{photoId}` lookup item because session-scoped User keys keep the ownership boundary explicit and avoid client-provided User IDs.

Timeline items will carry only the fields needed for list rendering and filtering, while the canonical Photo item remains the source for full Photo Metadata and single-photo actions.
