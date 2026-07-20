# Personal Light Table — Phase 2 Implementation Plan

Status: Proposed for final confirmation, 20 July 2026

This plan implements section 2, **Chronology and scale foundation**, from [Personal Light Table Design](./personal-light-table-design.md). It incorporates the chronology, pagination, thumbnail, migration, Restore Photo, and Processing Issues decisions recorded in ADRs 0022–0043 and the canonical language in [CONTEXT.md](../CONTEXT.md).

## Outcome

At the end of Phase 2:

- every new Ready Photo has truthful structured chronology, two Timeline Thumbnail variants, one Active or Archived projection, and an exact Date Index contribution;
- existing Ready Photos have been idempotently backfilled and reconciled without replacing Original Photos or Display Photos;
- Timeline and Archive expose bounded cursor reads and period anchors suitable for a 20,000-Photo Personal Album;
- Adjust/Revert Captured At and Archive/Restore have atomic backend contracts;
- Processing Issues survive refreshes and retries and have an exact navigation count;
- the current Phase 1 Web experience remains usable through compatibility APIs;
- the new browsing and management UI remains deferred to Phases 3 and 4.

## Scope Boundary

Phase 2 includes shared contracts, API handlers, store operations, processing reliability, infrastructure, migration, reconciliation, and compatibility behavior. The only required Web change is sending the browser's validated IANA upload-context time zone with a new Upload Batch.

Phase 2 does not build Justified Rows, year/month navigation UI, the new Photo Viewer, date-adjustment UI, Archive Undo, the Processing Issues destination, Upload Tray, DOM recycling, gestures, or scroll restoration.

## 1. Chronology Contract

### Structured values

`CapturedAt` is a discriminated shared value, never a JavaScript `Date` or an ISO instant:

```ts
type CapturedAt =
  | { precision: "year"; localDate: string }
  | { precision: "month"; localDate: string }
  | { precision: "day"; localDate: string }
  | {
      precision: "dateTime";
      localDate: string;
      localTime: string;
      timeResolution: "minute" | "second" | "subsecond";
      offset?: string;
    };
```

The shared validator enforces:

- four-digit proleptic Gregorian years `0001`–`9999`, with no year zero or signed years;
- valid month/day combinations and leap years without automatic rollover;
- `HH:mm`, `HH:mm:ss`, or fractional seconds consistent with `timeResolution`;
- a bounded canonical subsecond representation;
- a canonical explicit offset when present, without requiring one for Date-and-Time;
- no offset on Year, Month, or Day values.

`CapturedAtSource` becomes `exif | fileModifiedTime | uploadTime | userAdjusted`. `OriginalCapturedAtSource` excludes `userAdjusted`.

The v2 domain/API view of each Ready Photo exposes:

```ts
originalCapturedAt: CapturedAt;
originalCapturedAtSource: OriginalCapturedAtSource;
capturedAt: CapturedAt;
capturedAtSource: CapturedAtSource;
capturedAtRevision: number;
addedAt: string; // authoritative instant
```

Original chronology is immutable. Migration initializes revision `0` and makes active chronology equal to original chronology. Adjust replaces the complete active value; Revert restores the complete original value and source.

### EXIF and fallbacks

The processing extractor tries:

1. valid `DateTimeOriginal`, paired only with its original offset and subsecond tags;
2. valid `DateTimeDigitized`, paired only with its digitized offset and subsecond tags;
3. file-modified fallback;
4. upload-time fallback.

Generic EXIF `DateTime` is not a capture date. Invalid calendar data advances to the next candidate; an invalid offset only removes the offset. GPS, filenames, camera details, server location, and browser offset never infer Capture Time Offset.

The v2 Upload Batch request contains one `uploadContext.timeZone`. The server validates the IANA zone and derives `fileModifiedLocalDateTime` and `uploadLocalDateTime` from authoritative instants, then persists those values so reads never reinterpret them. Old requests remain on the explicit v1 path during migration.

### Deterministic chronology order

At each component boundary, known values sort newest first before unknown values. Month-only follows known days in its month; Day-only follows known times on its day; minute-only follows known seconds in its minute; second-only follows known subseconds in its second. Year-only follows all known months under Date Unknown.

Identical known components use Added At newest first and Photo ID as the final deterministic tie-breaker. Capture Time Offset does not alter capture-local ordering.

A shared chronology-key builder uses fixed-width segments with explicit known/unknown markers. Store adapters use the key; handlers and clients never reconstruct it.

## 2. Photo and Projection Storage

### Photo fields

The v2 Photo record adds structured chronology, structured Timeline Thumbnail variants, processing-attempt fields, and `migrationVersion`. During expand, chronology is stored under a new nested attribute so the legacy `capturedAt` string and `capturedAtSource` attributes remain untouched for the v1 reader:

```ts
chronology: {
  original: {
    capturedAt: CapturedAt;
    source: OriginalCapturedAtSource;
  };
  active: {
    capturedAt: CapturedAt;
    source: CapturedAtSource;
    revision: number;
  };
};
```

The store adapter maps this persistence shape to the v2 domain/API fields. New processing temporarily writes both the old flat chronology and the nested v2 chronology; backfill adds the nested value without overwriting the old one. Contract cleanup may remove the legacy flat attributes after no v1 reader remains, but does not need to rename the stable nested representation.

The unused `uploaded` Processing State is removed from shared types, validators, API counts, and tests.

```ts
timelineThumbnails: {
  small: { objectKey: string; dimensions: Dimensions };
  large: { objectKey: string; dimensions: Dimensions };
};

processingAttemptId?: string;
processingStartedAt?: string;
migrationVersion?: number;
```

### Timeline and Archive projections

Ready Photos have exactly one lightweight projection:

```text
PK = USER#{userId}
SK = TIMELINE_V2#{ACTIVE|ARCHIVED}#{chronologyKey}#{addedAt}#{photoId}
```

The projection contains only list-rendering data: Photo ID, Original File Name, active Captured At, Added At, Display dimensions, and both Thumbnail keys and dimensions. It contains no Original key, Photo Metadata, Processing State, raw failure detail, or temporary URL.

The authoritative Photo remains the write model. Ready, Archive, Restore, Adjust, Revert, and thumbnail repair transactionally maintain the projection. A non-Ready Photo has no Timeline or Archive projection.

### Date Index

Active and Archived collections each store one counter item per year:

```text
PK = USER#{userId}
SK = DATE_INDEX_V2#{ACTIVE|ARCHIVED}#{year}
```

The item contains counters for months `01`–`12` and Date Unknown. Annual totals are derived at read time. Zero counters may remain stored but are omitted by the API. Every projection membership or period change updates the appropriate counter items in the same transaction, with conditions preventing negative counts.

### Processing Issues

One durable Issue item exists per failed Photo:

```text
PK = USER#{userId}
SK = PROCESSING_ISSUE#{addedAt}#{photoId}
```

It contains User-facing row data, a stable reason code, `failed | retrying`, first-opened time, attempt count, and last-attempt time. A `PROCESSING_ISSUES#SUMMARY` item stores the exact open count. Raw infrastructure diagnostics remain in logs and the DLQ.

The Issue persists through retry and repeated failure. It resolves transactionally when the Photo becomes Ready or Exact Duplicate; only Ready creates a Timeline/Archive projection and Date Index contribution.

## 3. API Contracts

### Collection reads

Compatibility keeps the old `/timeline` reader temporarily. The new reader uses separately versioned routes during cutover:

```http
GET /v2/timeline?limit=80&cursor=...
GET /v2/timeline?limit=80&startAt=1990-07
GET /v2/archive?limit=80&cursor=...
```

Rules:

- default limit 80, allowed range 1–100;
- `cursor` and `startAt` are mutually exclusive;
- `startAt` accepts `YYYY-MM` or `YYYY-unknown` and anchors a continuous older stream rather than filtering one period;
- an anchor that became empty returns an explicit conflict so the client refreshes navigation;
- each page uses a strongly consistent DynamoDB Query;
- a versioned opaque cursor is scoped to Active or Archived and resumes strictly after the last projection key;
- cursors promise deterministic live continuation, not a cross-request snapshot.

Each page returns Photos, an optional next cursor, the anchor period, and temporary responsive Thumbnail sources. Object keys never cross the API boundary.

### Navigation summary

```http
GET /album-navigation
```

returns non-empty Timeline and Archive year/month counts plus `processingIssueCount`. It reads only Date Index and Issue summary projections, uses private `no-store` semantics, and remains separate from Session.

### Captured At adjustment

```http
PUT /photos/{photoId}/captured-at-adjustment
DELETE /photos/{photoId}/captured-at-adjustment
```

Both operations apply only to Ready Photos, including Archived Photos. PUT accepts every Captured At Precision and fully replaces active chronology. DELETE is idempotent Revert.

Photo detail and mutation responses include original chronology, active chronology, revision, and an ETag. Mutation requires `If-Match`; missing preconditions return `428`, stale revisions return `412`. Identical retry and already-reverted operations do not create a new revision.

### Archive membership

```http
PUT /photos/{photoId}/archive
DELETE /photos/{photoId}/archive
```

Both are idempotent Ready-Photo operations. They update Photo state, move the collection projection, and transfer Date Index count in one transaction. The old POST Archive endpoint remains during compatibility.

### Thumbnail access

```http
POST /timeline-thumbnail-access
```

accepts up to 100 Photo IDs and returns new 300-second Small/Large sources for Ready Photos in the current Personal Album. The client never supplies object keys. Equal actual widths collapse to the Large candidate. Initial collection pages already include sources, so this endpoint is only for visible or soon-visible refresh after expiry.

### Processing Issues and retry

```http
GET /processing-issues?limit=50&cursor=...
POST /photos/{photoId}/retry-processing
```

Issue reads are cursor-paginated by Added At newest first. Retry sends a message containing `retryAttemptId` before conditionally marking the Issue retrying, and returns `202`. Send failure leaves it failed; duplicate retry requests converge on the current attempt.

## 4. Transaction Boundaries

The `PersonalAlbum` store exposes intention-revealing operations rather than handlers composing DynamoDB commands. The DynamoDB adapter implements them with `TransactWrite`; the in-memory adapter implements identical state transitions for contract tests.

Required atomic operations include:

- publish Ready Photo, projection, Date Index, and Issue resolution;
- publish Exact Duplicate and Issue resolution without projection;
- move Active ↔ Archived and transfer Date Index count;
- replace or revert chronology, move projection, and transfer period counts;
- create/update Processing Issue and open count;
- claim, resume, fail, and complete a specific processing attempt;
- apply or repair v2 migration state.

Transactions condition authoritative Processing State, archive membership, chronology revision, current projection key, and processing attempt identity as applicable. Handlers refetch and retry only when the intended operations commute; stale User chronology edits return the explicit precondition failure.

## 5. Photo Processing and Thumbnail Generation

Small remains `timeline-thumbnails/{userId}/{photoId}.jpg`; Large is `timeline-thumbnails/{userId}/{photoId}-large.jpg`. Shared key builders own both formats.

Both variants:

- correct orientation;
- strip source metadata;
- emit deterministic JPEG;
- preserve aspect ratio;
- never enlarge;
- always exist under separate physical keys, even when their actual dimensions match.

Small targets a maximum 320px long edge; Large targets 640px. When actual widths match, the responsive API exposes only Large.

Processing persists an attempt ID before risky work. A redelivery of the same attempt resumes; another live attempt cannot take over. Fixed output keys and conditional final transactions make resumed work idempotent. The Lambda returns real partial batch failures. On the configured final receive it best-effort creates a Processing Issue and still sends the failed record to the DLQ; database outages that prevent this appear in reconciliation.

## 6. Migration and Rollout

### Expand

- add side-by-side v2 fields, key builders, projections, endpoints, transactions, and maintenance infrastructure without changing the types of v1 attributes;
- make new processing write complete v2 data and both Thumbnail variants;
- temporarily maintain the v1 representation needed by the current Web client;
- make Archive compatibility update v2 when present;
- migrate existing Processing Failed Photos into durable Issue items and reconcile the open count;
- report any unexpected legacy `uploaded` records as anomalies rather than guessing.

### Backfill

An idempotent coordinator scans Ready Photo records and places `{userId, photoId, migrationVersion}` on a dedicated Photo Maintenance queue. The batch-size-one worker, initially limited to concurrency 2:

1. reloads and condition-checks the authoritative Photo;
2. reads the immutable Original Photo once;
3. re-extracts chronology with the new EXIF rules;
4. uses `Australia/Brisbane` as the explicit legacy fallback zone only when EXIF is unavailable;
5. reuses a valid existing Small Thumbnail and generates Large, repairing both if Small is absent;
6. initializes original and active chronology at revision 0;
7. writes the correct Active or Archived projection and Date Index contribution;
8. records migration version in the final transaction.

It does not rerun duplicate detection, rebuild Display Photo, mutate Original Photo, or change Ready Processing State. Fixed object keys make an S3 write followed by a failed transaction safe to retry.

### Reconcile

The migration report records version, IANA legacy zone, start/end time, queued/completed/failed/skipped counts, and DLQ entries. Reconciliation verifies:

- every Ready Photo has v2 chronology and revision;
- every Ready Photo has two Thumbnail objects and one correct collection projection;
- no non-Ready Photo has a collection projection;
- projection totals equal Date Index totals by collection and period;
- Processing Failed Photos and Issue items/count agree;
- no unexpected legacy state is silently omitted.

### Cut over and contract

Phase 2 stops after v2 writes, APIs, backfill, and reconciliation are ready while the current UI remains on v1. Phase 3 moves browsing to v2. Phase 4 consumes adjustment, Restore, and Issues contracts. Only after an observation period does a separate cleanup remove legacy Timeline items, compatibility fields, and old routes.

## 7. Implementation Work Packages

Work proceeds in dependency order:

1. **Shared chronology primitives** — types, validators, formatter-safe accessors, chronology keys, Thumbnail variants, removal of `uploaded`, exhaustive unit tables.
2. **Store transaction model** — new intention-revealing `PersonalAlbum` operations, in-memory contract behavior, DynamoDB transaction adapter, projection and counter key helpers.
3. **Upload and processing v2** — IANA upload context, EXIF candidates and offsets, attempt identity, two Thumbnail outputs, Ready/duplicate/failure transactions.
4. **Scale reads** — v2 Timeline/Archive pages, cursor codec, `startAt`, responsive source signing, `/album-navigation`, Thumbnail refresh.
5. **Mutation APIs** — Adjust/Revert with ETags, Archive/Restore membership, concurrency and idempotency behavior.
6. **Processing Issues** — durable projection/count, paginated read, send-first Retry, final-attempt/DLQ convergence, legacy failure migration.
7. **Maintenance infrastructure** — queue, DLQ, alarm, worker, coordinator, migration manifest, rate and concurrency configuration.
8. **Backfill and reconciliation** — dry run, targeted fixtures, production execution, count/object validation, failure reruns, cutover readiness report.
9. **Compatibility verification** — current Phase 1 Web behavior, v1 API stability, new upload context, rollback rehearsal, deployment and operator documentation.

Each package must leave tests green and preserve a deployable compatibility state; packages are not accumulated into one unreviewable migration commit.

## 8. Verification Matrix

### Chronology

- all four date precisions and three time resolutions;
- year bounds, leap years, invalid dates, invalid time, invalid/canonical offsets;
- Original versus Digitized EXIF precedence and paired offset/subsecond tags;
- offset-free EXIF, Brisbane fallback across day/year boundaries, and no viewer-time-zone reinterpretation;
- recursive unknown-component ordering and deterministic Added At/Photo ID ties;
- adjustments across month/year, precision, time resolution, and Archive membership;
- stale ETag, identical retry, and idempotent Revert.

### Storage and pagination

- store contract parity between in-memory and DynamoDB adapters;
- one and only one projection for each Ready Photo;
- exact counter movement for Ready, Archive, Restore, Adjust, Revert, and repair;
- 80/100 page boundaries, cursor scope/version validation, no-change traversal, live insertion, and `startAt` conflicts;
- no BatchGet or post-query visibility filtering on v2 collection reads.

### Processing and Issues

- JPEG, PNG, and HEIC extraction and two physical Thumbnail outputs;
- no enlargement, orientation, actual dimensions, and equal-width source collapse;
- same-attempt SQS redelivery, duplicate message, stale attempt, partial batch failure, final receive, and DLQ path;
- failure → retrying → failure, Ready, or Exact Duplicate;
- Issue count and row durability across retries and resolution;
- send failure versus database failure after accepted Retry message.

### Migration

- dry-run makes no writes;
- rerun after S3-only, DynamoDB-only, timeout, and conditional-conflict failures;
- existing Archived, offset-free EXIF, Digitized-only, fallback-only, and missing-Small cases;
- no change to Original or Display objects;
- complete reconciliation and explicit anomaly report.

Repository-wide completion checks remain:

```text
npm test
npm run check
npm run build
npm run cdk:synth
```

## 9. Phase 2 Completion Criteria

Phase 2 is complete only when:

- all new APIs and store contracts are implemented and tested;
- v1 behavior required by the current Web client still works;
- new uploads write complete v2 data and both Thumbnail objects;
- the production backfill is complete or an explicitly approved environment has no legacy data;
- reconciliation reports zero unexplained Ready, projection, Date Index, Thumbnail, Processing Issue, or legacy-state discrepancies;
- DLQs and alarms are empty/healthy after test messages are resolved;
- rollback to the v1 reader has been rehearsed before Phase 3 cutover;
- deployment and migration commands are documented without destructive implicit cleanup;
- no Phase 3 or Phase 4 UI has been pulled into this slice.
