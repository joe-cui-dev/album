# Use Family Allowlist Users with Session-Scoped Photo Access

The album will support a small family User Allowlist instead of a single Owner or public registration. Each User has exactly one independent Personal Album, identified by a stable User ID rather than email address, and the app will not provide an administrator role for browsing other Users' albums.

Photo access will be authorized through the API using the signed-in User's session before returning temporary URLs for Display Access or Original Download. This supersedes the long-lived static CloudFront-path approach from ADR-0003 for Display Photos, because multi-user isolation needs every photo access decision to be scoped to the current User.

The `album.joe-cui.com` domain is reserved for the Shared App Entry. Display Access will be implemented through API-authorized short-lived object URLs rather than a display-photo CloudFront distribution on the app domain.

Object storage keys and metadata records will include the owning User ID as a first-class ownership boundary. Clients must not choose or override that User ID; API handlers derive it from the authenticated session.

Timeline reads will be keyed by User ID and Captured At so the primary browsing query is naturally scoped to one User's Personal Album. The system should not query a global timeline and then filter by User afterward.
