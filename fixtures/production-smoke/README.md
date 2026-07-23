# Production-smoke fixtures

These deliberately synthetic files exercise JPEG, PNG fallback, genuine HEIC, and
safe Processing Failed behaviour. Generate them locally with:

```sh
node scripts/generate-smoke-fixtures.mjs
npm run verify:smoke-fixtures
```

The generator uses macOS `sips` to encode the HEVC HEIC container, then verifies it
through Sharp. It also creates byte-unique `run-variants/` copies and prints their SHA-256
values; record only those hashes in acceptance evidence. Do not upload the fixture sources
or run variants until the production smoke step has been separately authorised.

`png-file-modified.png` is deliberately stamped `2024-04-05T06:07:08.000Z`. Preserve that
mtime when copying it, since this file verifies the file-modified fallback.
