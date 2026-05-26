# Create Photo Records Before Direct Upload

Create Upload Batch will create a Photo record for each selected Original Photo before returning presigned upload URLs, with each Photo starting in the `uploadRequested` Processing State. This makes Upload Batch status visible immediately, lets the processor advance an existing Photo through upload and processing states, and prevents a missed or delayed S3 object-created event from being the only evidence that a User intended to upload a photo.

The first version will not automatically mark `uploadRequested` photos as failed when a User never completes the direct S3 upload. Upload Batch status will continue to show those photos as `uploadRequested`, while S3 lifecycle rules handle abandoned multipart upload cleanup.

Upload Batch status will return batch-level counts and a lightweight per-Photo status list, enough for the frontend to show progress, failures, duplicates, and retry actions. It will not return presigned URLs or S3 object keys; photo bytes remain accessed through explicit Display Access and Original Download flows.
