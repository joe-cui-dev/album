# Phase 5 Work Checklist

This checklist completes Photo Processing for the MVP while keeping Timeline browsing, photo detail, Display Access, and Original Download in Phase 6.

## Decisions Already Resolved

- Use `sharp` in the photo processing Lambda.
- Generate Display Photos as JPEG.
- Use Display Size of longest edge 2048 pixels, preserving aspect ratio and not enlarging smaller photos.
- Auto-orient Display Photos for normal viewing.
- HEIC must process to ready Display Photos in Phase 5.
- Create Photo records during Create Upload Batch with initial `uploadRequested` state.
- Do not auto-fail abandoned `uploadRequested` photos in Phase 5.
- Use client SHA-256 only as an early Exact Duplicate hint; processor-computed S3 hash is authoritative.
- Do not delete duplicate Original Photos in Phase 5.
- Use `fileModifiedAt` from Create Upload Batch as the file modified time fallback for Captured At.
- Keep canonical Photo items inside the owning User's DynamoDB partition.
- Write lightweight Timeline items during processing once Captured At is known.
- Retry Processing uses a custom message on the same SQS processing queue.
- Retry Processing is only allowed for `processingFailed` photos.
- Business processing failures become `processingFailed`; transient infrastructure errors can retry through SQS and DLQ.
- Upload Batch status returns counts and lightweight per-Photo status.
- Phase 5 frontend covers upload, processing status, Exact Duplicate visibility, failure visibility, and retry.
- Browser SHA-256 hashing is attempted but upload can continue without it.
- Enforce 50 MB per Original Photo and 100 photos per Upload Batch.
- Frontend/API validate Supported Photo Format by MIME type and extension; processor validates by actual decode.
- Preserve Location metadata when present.
- Store `failureCode` plus a user-facing failure message; keep detailed errors in logs.
- Verify with small JPEG, PNG, and real HEIC fixtures.
- Store Original Photos at `originals/{userId}/{uploadBatchId}/{photoId}`.
- Store Display Photos at `display/{userId}/{photoId}.jpg`.
- Processor cross-checks identity from S3 key and S3 metadata.
- Metadata mismatch marks an existing matching Photo as `processingFailed`; invalid or unknown objects are logged and acknowledged.
- `album.joe-cui.com` hosts the SPA, not Display Photos.
- Phase 5 uses the default HTTP API invoke URL injected into Vite config.
- Cross-site session cookies use `SameSite=None; Secure`; frontend requests include credentials.

## Infrastructure

- [x] Replace the display-photo CloudFront distribution on `album.joe-cui.com` with SPA hosting through S3 and CloudFront.
- [x] Add a deployable web asset bucket or static asset deployment path for the Vite build.
- [x] Output or configure the HTTP API default invoke URL for frontend build/runtime configuration.
- [x] Change S3 object-created notification prefix from `users/` to `originals/`.
- [x] Give the Retry API handler permission to send messages to the processing queue.
- [x] Configure processor Lambda bundling for Linux-compatible `sharp`, with the Lambda architecture and installed sharp platform kept in sync.
- Keep processor reserved concurrency and DLQ alarms in place.
- [x] Ensure API CORS allows credentials only from configured SPA origins, with local dev origin added only by explicit config.

## Shared Types

- [x] Add request/response types for Upload Batch status.
- [x] Add request/response types for Retry Processing.
- [x] Expand `Photo` or related shared types with `failureCode`, user-facing failure message, display dimensions, `displayObjectKey`, and authoritative `sha256`.
- Add constants or helpers for Supported Photo Format, max file size, max batch size, Display Size, and object key parsing if useful.

## Create Upload Batch API

- [x] Validate authenticated session.
- [x] Validate max 100 files per batch.
- [x] Validate each file is <= 50 MB.
- [x] Validate MIME type and file extension for JPEG, PNG, and HEIC.
- [x] Create one canonical Photo item per file under `pk = USER#{userId}`, `sk = PHOTO#{photoId}`.
- [x] Set initial state to `uploadRequested`.
- [x] Store file name, format, file size, client SHA-256 hint if present, upload time, and valid `fileModifiedAt` if supplied.
- [x] Generate Original Photo keys as `originals/{userId}/{uploadBatchId}/{photoId}`.
- [x] Put `user-id`, `upload-batch-id`, `photo-id`, original file name, client SHA-256, and file modified time in S3 object metadata for the presigned PUT.
- [x] Keep Upload Batch item with photo ids and created time.
- [x] Return upload URLs and lightweight upload descriptors without exposing unnecessary storage internals beyond what the direct PUT needs.

## Upload Batch Status API

- [x] Add `GET /upload-batches/{uploadBatchId}`.
- [x] Derive User ID from session and query only that User's partition.
- [x] Return batch-level counts by Processing State.
- [x] Return per-photo lightweight status: `photoId`, `fileName`, `processingState`, duplicate indicator when applicable, `failureCode`, and user-facing failure message.
- [x] Do not return S3 object keys, Display Access URLs, Original Download URLs, or presigned upload URLs.

## Processor Lambda

- [x] Support S3 object-created messages for Original Photos.
- [x] Support custom retry messages from the Retry API.
- [x] Parse and validate Original Photo keys in the `originals/{userId}/{uploadBatchId}/{photoId}` shape.
- [x] Load S3 object metadata and cross-check `userId`, `uploadBatchId`, and `photoId`.
- [x] If mismatch identifies an existing Photo, mark it `processingFailed`; otherwise log and acknowledge.
- [x] Transition existing Photo from `uploadRequested` or `processingFailed` retry into `processing`.
- [x] Stream/read S3 object and compute authoritative SHA-256.
- [x] Detect Exact Duplicate within the same User's Personal Album using authoritative SHA-256.
- [x] Mark duplicates as `exactDuplicate` without deleting the uploaded Original Photo.
- Extract Captured At using EXIF, then client file modified time, then upload time.
- Extract display dimensions after orientation, camera metadata, lens metadata, and Location when present.
- [x] Generate one JPEG Display Photo with longest edge 2048 pixels and no enlargement.
- [x] Store Display Photo at `display/{userId}/{photoId}.jpg`.
- [x] Write canonical Photo update with `ready`, authoritative hash, display object key, Captured At, Captured At Source, metadata, and display dimensions.
- [x] Write lightweight Timeline item under the same User partition after Captured At is known.
- [x] For business decode/metadata/image failures, mark `processingFailed` with `failureCode` and user-facing message, then acknowledge.
- For transient S3/DynamoDB failures, let SQS retry and eventually DLQ.

## Retry Processing API

- [x] Add `POST /photos/{photoId}/retry-processing`.
- [x] Derive User ID from session.
- [x] Load canonical Photo item from `USER#{userId}` and `PHOTO#{photoId}`.
- [x] Allow retry only when Processing State is `processingFailed`.
- [x] Send a custom retry message to the processing queue with `userId`, `photoId`, and `originalObjectKey`.
- [x] Return the updated or accepted lightweight Photo status.

## Frontend

- [x] Replace the static scaffold with real session loading, sign-in code request, verification, and sign-out.
- [x] Configure API base URL from Vite environment.
- [x] Use `credentials: "include"` for API calls.
- [x] Build a plain multi-file picker for JPEG, PNG, and HEIC.
- [x] Add frontend validation for max 100 files per Upload Batch before calling the API.
- [x] Keep invalid selected files visible with a reason and exclude them from Create Upload Batch.
- [x] Allow removing individual selected files before creating the Upload Batch.
- [x] Validate 50 MB per file before calling the API.
- [x] Compute SHA-256 in the browser when possible, but allow upload if hashing fails.
- [x] Send Create Upload Batch with file name, MIME type, size, client hash hint, and file modified time.
- [x] Upload each file directly to S3 with progress UI.
- [x] Poll Upload Batch status every 2 seconds after upload starts.
- [x] Stop Upload Batch polling when every photo is terminal: `ready`, `processingFailed`, or `exactDuplicate`.
- [x] Keep the most recent Upload Batch visible without adding historical batch browsing.
- [x] Show per-photo states including `uploadRequested`, `uploaded`, `processing`, `ready`, `processingFailed`, and `exactDuplicate`.
- [x] Show Exact Duplicate visibility without Display Photo previews.
- [x] Show user-facing failure messages without internal stack traces or object keys.
- [x] Show Retry Processing action only for `processingFailed`.
- [x] Resume polling after Retry Processing succeeds without optimistically changing the Processing State.
- [x] Keep Timeline browsing, photo detail, Display Access, and Original Download out of Phase 5 UI.

## Verification

- Add small non-private JPEG, PNG, and real HEIC fixtures.
- [x] Verify `npm run check --workspaces --if-present`.
- [x] Verify `npm run cdk:synth`.
- [x] Verify Create Upload Batch creates Photo records before S3 upload.
- Verify successful JPEG, PNG, and HEIC uploads become `ready`.
- Verify Display Photos are JPEG, oriented correctly, and constrained to 2048 px longest edge.
- Verify Captured At fallback uses EXIF, then client file modified time, then upload time.
- Verify Exact Duplicate is decided by authoritative S3 hash.
- Verify duplicate Original Photos are not deleted in Phase 5.
- Verify malformed metadata mismatch becomes `processingFailed` only when a matching Photo exists.
- Verify Retry Processing uses SQS and only accepts `processingFailed`.
- Verify cross-site session works from hosted SPA to default API invoke URL with credentials.
- [x] Add a deployment runbook.
- [x] Add a manually triggered deployment script.
