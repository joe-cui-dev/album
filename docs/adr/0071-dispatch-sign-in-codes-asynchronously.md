# Dispatch Sign-In Codes Asynchronously

Sign-In Code requests will enter a dedicated private queue and return the same accepted response without a public code identifier before email delivery, while a worker checks the User Allowlist and sends only for an Allowed User. Non-allowed requests follow the same public admission shape but become a no-op in the worker; verification uses Email Address plus Code and one generic invalid-or-expired result. This adds a queue and worker in exchange for removing response-body and synchronous SES timing signals that would otherwise reveal allowlist membership.

The breaking no-code-ID contract will enter through additive v2 request and verify routes. The new Web client cuts over while v1 remains for a 24-hour observation window, after which v1 is removed before MVP acceptance; existing Session reads and Sign Out remain unversioned.
