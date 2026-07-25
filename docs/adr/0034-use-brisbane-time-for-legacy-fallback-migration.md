# Use Brisbane Time for Legacy Fallback Migration

Status: partially retired (2026-07-25) — the migration backfill half is retired along with the rest of the Phase 2 scaffolding (see ADR-0033); the `Australia/Brisbane` fallback for a new upload arriving without a browser IANA upload context remains in effect.

The chronology backfill will require an explicit legacy fallback time zone and use `Australia/Brisbane` to reconstruct capture-local calendar values from old absolute file-modified and upload-requested instants when no valid EXIF capture time exists. The chosen IANA zone and migration version will be recorded in the migration manifest, never inferred from the machine or AWS Region, and will not become Capture Time Offset because it is reconstruction context rather than capture evidence. New uploads provide their browser's IANA upload context so the server can persist browser-local calendar values, and exceptional legacy placements remain correctable through Adjust Captured At.
