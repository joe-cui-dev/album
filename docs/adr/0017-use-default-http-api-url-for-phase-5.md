# Use the Default HTTP API URL for Phase 5

Phase 5 will not bind API Gateway to a custom API domain. The hosted SPA will receive the HTTP API default invoke URL through Vite configuration, accepting the extra cross-origin cookie and CORS care for the phase in exchange for avoiding additional certificate, DNS, and routing setup before the upload processing workflow is complete.

Because the SPA and default API invoke URL are cross-site, Phase 5 session cookies will use `SameSite=None; Secure`, API CORS will allow credentials only from configured SPA origins, and frontend API calls will include credentials. This can be revisited if the API later moves behind a same-site `/api/*` route.
