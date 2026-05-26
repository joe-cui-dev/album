# Buffer Photo Processing with SQS

S3 object-created events for Original Photos will be routed through SQS before invoking the photo processing Lambda, with a dead-letter queue for failures. This adds a small amount of infrastructure but smooths Upload Batch spikes, enables controlled processor concurrency, and makes failed processing easier to inspect and retry.

Retry Processing will also use the processing queue. The Retry API will authorize the signed-in User, verify that the Photo is eligible for retry, and send a custom retry message to the same SQS queue so first-time processing and retry processing share the same processor, concurrency limits, logging, and DLQ behavior.

Business processing failures, such as an unreadable or unsupported uploaded photo, will mark the Photo as `processingFailed` and acknowledge the SQS message. Infrastructure or transient failures, such as temporary S3 or DynamoDB errors, may fail the SQS message so normal retry and DLQ behavior applies.

Processing failure records will store an internal `failureCode` and a short user-facing failure message. Detailed processor errors, library messages, stack traces, and object keys belong in logs rather than API responses.
