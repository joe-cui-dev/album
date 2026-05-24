# Buffer Photo Processing with SQS

S3 object-created events for Original Photos will be routed through SQS before invoking the photo processing Lambda, with a dead-letter queue for failures. This adds a small amount of infrastructure but smooths Upload Batch spikes, enables controlled processor concurrency, and makes failed processing easier to inspect and retry.
