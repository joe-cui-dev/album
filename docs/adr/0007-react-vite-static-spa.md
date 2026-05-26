# Use a React Vite Static SPA

The web frontend will be a React and TypeScript single-page app built with Vite and deployed as static assets. This avoids server-side rendering infrastructure and keeps idle cost low, while still supporting the interactive upload, Timeline, and Processing State workflows needed by the Personal Album.

The production Shared App Entry at `album.joe-cui.com` will point to the hosted SPA, delivered from object storage through CloudFront. The frontend will receive the API base URL through Vite configuration rather than sharing the app domain with Display Photo delivery.
