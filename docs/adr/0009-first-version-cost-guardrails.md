# Include Cost Guardrails in the First Version

The first version will include AWS Budgets alerts, bounded CloudWatch log retention, Lambda reserved concurrency limits, upload size limits, and S3 lifecycle cleanup for incomplete multipart uploads. Serverless architecture reduces idle cost, but these Cost Guardrails reduce the risk of surprise bills from large uploads, runaway processing, excessive logs, or misconfiguration.
