# Delete Photo Objects Before Records, on a Scheduled Sweep

Permanent Deletion removes a Photo's stored objects before removing its DynamoDB record, and Deleted Photos whose Retention Window has ended are swept by a scheduled daily Lambda rather than by DynamoDB TTL. S3 deletion cannot join the DynamoDB transaction, so one of two failure modes has to be chosen: removing the record first can leave object versions that nothing points to and no query can find, while removing the objects first can leave a Photo still listed in Trash with a broken thumbnail. The second is visible and self-healing -- the next sweep retries the whole deletion, and every step is idempotent because deleting a missing S3 key succeeds -- so that is the order we take.

DynamoDB TTL was rejected on both counts: its deletion latency reaches 48 hours, which would make a 30-day Retention Window untrue, and it forces exactly the record-first ordering this decision rejects. Sweeping lazily when the User opens Trash was rejected because it turns expiry into a promise the app cannot keep for a User who rarely opens Trash, and because it attaches unattended failure-prone work to a read request.

## Consequences

- The scheduled rule and its sweeper Lambda are the first scheduled infrastructure in the stack; there is no existing EventBridge rule to extend.
- A Photo can briefly appear in Trash without a usable thumbnail. This is a transient state between a completed object deletion and its retried record deletion, not a state the UI needs to model specially.
- Permanent Deletion creates S3 delete markers, so ADR-0072's noncurrent-version rules still bound how long the removed bytes survive for operational recovery.
