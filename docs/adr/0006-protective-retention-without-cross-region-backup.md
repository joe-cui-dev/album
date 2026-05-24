# Use Protective Retention Without Cross-Region Backup

The first version will use S3 versioning, DynamoDB point-in-time recovery, and Archived Photo semantics to recover from accidental deletion or metadata mistakes. It will not implement cross-region backup or disaster recovery, because the Personal Album prioritizes low idle cost and simple operations over multi-region resilience.
