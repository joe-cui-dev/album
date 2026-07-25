# Re-extract Legacy Ready Photos During Thumbnail Backfill

Status: deprecated (2026-07-25) — the app cleared all data before Phase 2 backfill ran; the legacy Ready Photos and migration scaffolding this ADR designed for no longer exist.

Migration will read each legacy Ready Photo's immutable Original Photo once to re-extract Captured At under the new EXIF rules and generate its missing Large Timeline Thumbnail, while retaining the existing Small Timeline Thumbnail and Display Photo. The idempotent, checkpointed backfill will initialize Original and active Captured At, create the appropriate Timeline or Archive projection, update the Date Index, and record a migration version without rerunning duplicate detection or changing a Ready Photo to Processing Failed when one migration attempt fails. The new read path will cut over only after Photo, projection, thumbnail, and Date Index counts reconcile.
