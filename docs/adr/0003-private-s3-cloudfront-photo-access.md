# Keep Photo Objects Private Behind CloudFront

Status: partially superseded by ADR-0011

Original Photo and Display Photo objects will remain private in S3. The web app will access Display Photos through a private CloudFront path using short-lived authorization, while Original Photos are only exposed through explicit temporary access for download or reprocessing; this preserves Private Access without giving every object a public URL.
