# Use Protective Retention Without Cross-Region Backup

The first version will use S3 versioning, DynamoDB point-in-time recovery, and the Trash Retention Window (ADR-0075) to recover from accidental deletion or metadata mistakes; the Retention Window is the User-reachable safety net and the other two are operational. It will not implement cross-region backup or disaster recovery, because the Personal Album prioritizes low idle cost and simple operations over multi-region resilience.
