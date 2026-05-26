# Check Exact Duplicates After Authoritative Hashing

Create Upload Batch may use a client-provided SHA-256 hash only as an early Exact Duplicate hint, not as the final decision. The processor will compute the authoritative SHA-256 from the uploaded Original Photo in S3 and use that value to decide whether the Photo becomes `exactDuplicate`, because the client controls pre-upload hashes while S3 object contents are the source of truth.

Phase 5 will not delete an uploaded Original Photo that is later marked `exactDuplicate`. The duplicate Photo record will be marked with the duplicate state while the Original Photo remains preserved, avoiding accidental data loss from a bad hash/indexing bug and leaving cleanup policy as a separate future decision.

The frontend will try to compute a SHA-256 hash with browser APIs before creating an Upload Batch, but upload must still be allowed if client hashing fails or is skipped. The server-side processor remains responsible for the authoritative hash.
