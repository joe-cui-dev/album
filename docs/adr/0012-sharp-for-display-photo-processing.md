# Use Sharp for Display Photo Processing

Display Photos will be generated in the photo processing Lambda with `sharp` and written as JPEG files. This accepts the extra Lambda bundling work for a native image processing dependency because the MVP needs reliable resizing and format handling for user-uploaded JPEG, PNG, and HEIC photos; pure JavaScript or WASM alternatives reduce build friction but add more uncertainty around performance, metadata handling, and HEIC compatibility. Keeping Display Photos in one web-friendly output format simplifies browser display and temporary Display Access while Original Photos remain preserved exactly as uploaded.

Phase 5 is not complete unless real HEIC uploads can be processed into ready Display Photos, so the Lambda build must be verified with representative HEIC files rather than treating HEIC codec failure as an acceptable Processing Failed outcome.

Processing verification will include small JPEG, PNG, and real HEIC fixtures so the image pipeline is tested against every Supported Photo Format in the MVP.

Photo objects will use top-level type prefixes so S3 notifications can target Original Photos without also triggering on generated Display Photos. Original Photos will be written under `originals/{userId}/{uploadBatchId}/{photoId}`, and Display Photos will be written under `display/{userId}/{photoId}.jpg`.

The processor will parse ownership and identity from the Original Photo key and cross-check those values against S3 object metadata before updating Photo records, so malformed or manually placed objects cannot silently contaminate a User's Personal Album.

When the key and metadata disagree, the processor will mark an existing matching Photo as `processingFailed` if the key still identifies one. If the key is invalid or no matching Photo exists, the processor will log the problem and acknowledge the message without creating new album data.
