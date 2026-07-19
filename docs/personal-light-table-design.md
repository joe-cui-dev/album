# Personal Light Table Design

Status: Accepted design baseline, 19 July 2026

Personal Light Table is the internal design direction for Personal Album. It reshapes the product as a quiet, photo-first place for one User to revisit their own memories. It does not change the ownership boundary: every User has one independent Personal Album and cannot browse another family User's Photos.

The canonical product language remains in [CONTEXT.md](../CONTEXT.md). Capture-local chronology and date precision are constrained by [ADR 0022](./adr/0022-preserve-capture-local-time.md) and [ADR 0023](./adr/0023-preserve-captured-at-precision.md). Responsive Timeline Thumbnail sizes are constrained by [ADR 0024](./adr/0024-generate-two-responsive-timeline-thumbnail-sizes.md).

## Product Thesis

The signed-in product has one primary job: browse the Timeline. Manual Upload, Archive, Processing Issues, Photo Metadata, and Original Download remain important but are secondary to looking at Photos.

“Personal Light Table” is not a User-facing name or navigation label. The interface uses familiar product language:

- `Album`
- `Your album`
- `Add photos`
- `Archive`
- `Processing issues`

The product must not imply that family Users share one album. “Family” describes the small allowlist audience, not a shared content boundary.

## Experience Principles

1. Photos dominate the interface; controls explain themselves and then recede.
2. Timeline chronology tells the truth about capture-local calendar time and known date precision.
3. Browsing remains fluid on a phone and with a long-lived Personal Album.
4. Management actions appear where they are needed instead of turning the Timeline into an administration dashboard.
5. Photographic character comes from light, proportion, and data typography, not nostalgic decoration.
6. Empty, loading, failure, and recovery states are part of the product rather than generic fallback screens.

## Information Architecture

The primary destinations are:

- **Timeline** — the default signed-in destination and continuous browsing view.
- **Archive** — a separate view of Archived Photos with the same chronological structure.
- **Processing Issues** — a conditional destination visible only while at least one Processing Issue is open.
- **Photo Viewer** — a privately addressable route for one Photo.

The global shell includes the Album wordmark, Archive, Add photos, a conditional Processing Issues entry, and the User menu. Search, folders, tags, and multi-select are absent.

Photo Viewer routes are stable application URLs, for example `/album/photos/{photoId}`. They remain protected by the signed-in Session. A Viewer URL is not a Display Access URL and does not grant another User access.

## Visual System

### Colour

| Token | Value | Role |
| --- | --- | --- |
| Table glow | `#EDF2F1` | Timeline and sign-in background |
| Print white | `#FBFCFB` | Inputs, menus, and Upload Tray surfaces |
| Album ink | `#15242B` | Primary text and dark icons |
| Emulsion blue | `#356A7C` | Primary actions, links, focus, and interactive state |
| Exposure amber | `#B7792B` | Current year/month position and restrained photographic emphasis |
| Darkroom | `#101619` | Photo Viewer background |

Success, warning, and error colours are separate semantic tokens. Exposure amber does not become a generic button colour, and Emulsion blue does not become decoration. Borders and secondary text derive from Album ink mixed with the relevant surface.

### Typography

- **Archivo** — years, important titles, and navigation.
- **Source Sans 3** — controls, form labels, explanations, and body copy.
- **Azeret Mono** — month markers, Captured At, Photo counts, sequence numbers, and camera metadata.

Suggested desktop scale:

| Role | Setting |
| --- | --- |
| Year | Archivo 48/52, weight 650 |
| Month | Archivo 18/24, weight 600 |
| Timeline marker | Azeret Mono 11/16, weight 500, uppercase |
| Body | Source Sans 3 16/24, weight 400 |
| Control | Source Sans 3 14/20, weight 600 |
| Metadata | Azeret Mono 12/18, weight 400 |

Mobile Year text reduces to about 30px. Mono is reserved for genuine data and is not applied to ordinary buttons or instructions. Fonts are self-hosted with system fallbacks, including reliable CJK fallbacks.

### Photographic Signature

The memorable element is the Timeline's year/month rail:

```text
JUL 2026
38 PHOTOS
```

The rail uses photographic data typography and Exposure amber to identify the current period. It always says `Photos`, never `Exposures`. The product does not use film sprocket holes, Polaroid frames, fake frame numbers, paper texture, dust effects, photo tilts, retro filters, gradient heroes, or stock family photography.

The Timeline is a cool, evenly lit surface. Photo Viewer transitions to Darkroom so one Photo can be viewed without peripheral glare. The transition is restrained and disabled when reduced motion is requested.

## Responsive Layout

Mobile completion of the core journeys is the quality baseline. Desktop adds density and efficiency rather than different capabilities.

### Desktop

```text
┌ Album ───────── Archive ─────── Add photos ─── User ┐
│                                                      │
│  2026        JUL 2026 · 38 PHOTOS                    │
│  2025        [     ][ ][        ][      ]            │
│  2024        [  ][       ][    ][       ]            │
│              JUN 2026 · 91 PHOTOS                    │
│              [   ][       ][ ][         ]            │
└──────────────────────────────────────────────────────┘
```

Years remain available as a compact index. Selecting a year jumps to its newest month with Photos; expanding it shows only months that contain Photos. Scrolling updates the active year without continuously adding browser history entries.

### Mobile

The Timeline is full width with compact Justified Rows. The current month marker sticks below the app bar and yields to the next month. Selecting it opens a `Jump to date` bottom sheet containing only years and months that have Photos.

Photo Viewer is full screen with swipe navigation while unzoomed and a bottom Info sheet. Upload Tray is a bottom sheet that can minimise to a persistent progress bar. Touch targets are at least 44px.

## Timeline

Timeline loads automatically after sign-in. It is continuous, newest first, and incrementally loads older Photos. It does not require a Refresh button or a year/month query form.

The design capacity target is 20,000 Ready Photos in one Personal Album. The client never depends on receiving, signing, rendering, or decoding every Photo at once.

Expected supporting behaviour:

- stable cursor pagination, approximately 60–100 Photos per increment;
- a lightweight date index or summary for year/month navigation and Photo counts;
- viewport-aware image loading and DOM recycling for distant periods;
- stable restoration of month and scroll position after closing Photo Viewer;
- limited prefetching of the next incremental page and adjacent Viewer Photos.

### Justified Rows

Timeline uses Justified Rows that preserve each Timeline Thumbnail's aspect ratio. Photos remain in chronological order from left to right and top to bottom. The design does not use square cropping or Masonry.

No file name or date caption remains visible below a thumbnail. Hover and keyboard focus reveal a restrained capture date overlay. Touch opens Photo Viewer immediately. Accessible names include the known capture date and Original File Name without inventing unknown date components.

Timeline contains only Ready, non-archived Photos. It does not display Processing State badges.

### Chronology

Captured At is a capture-local calendar value and never shifts because the viewing browser changes time zone. A reliable Capture Time Offset is preserved separately when available. Missing offset does not mean UTC.

Captured At supports four precision levels:

- Year
- Month
- Day
- Date and Time

Unknown values are not filled with January 1 or midnight. Month-, Day-, and Date-and-Time-precision Photos belong to their known month. Year-precision Photos appear after all known months in a `Date unknown` group for that year and use Added At, newest first, only to create a stable internal order.

Photo Viewer Info identifies Captured At Source. `Date from file` and `Date from upload` make fallbacks understandable without exposing implementation names.

The target experience includes `Adjust date and time`. Adjustment changes Timeline placement without rewriting the Original Photo, preserves Original Captured At, and can later support reverting to the extracted value. Full date/time adjustment may ship before partial-date adjustment, but the data model must not preclude Year, Month, or Day precision.

### Thumbnail Loading

Photo processing produces private Small and Large Timeline Thumbnails at approximately 320px and 640px on the long edge. Timeline exposes both through responsive image sources; Photo Viewer uses Display Photo.

Correct aspect-ratio space is reserved before loading. Thumbnails use a static neutral placeholder and one 120–160ms decode fade. There is no shimmer. Reduced-motion mode removes the fade. Expired temporary access for visible thumbnails is refreshed without per-photo User retry.

## Photo Viewer

Photo Viewer is a full-screen Darkroom route. It fits the complete Display Photo without cropping and includes Close, Previous, Next, Info, More, and a sequence indicator. Browser Back returns to the previous Timeline position.

Default chrome shows only the Photo, its known capture date, and essential navigation. Controls fade after inactivity and return on pointer, touch, or keyboard input.

Info is secondary and contains, when available:

1. Captured At and Captured At Source
2. Camera Make, Model, and Lens
3. Dimensions, Format, and File Size
4. Original File Name
5. Location coordinates

Viewer does not display `Ready`, because entry into Viewer already establishes that state. It does not infer a place name from coordinates.

Viewer supports limited zoom and pan against the 2048px Display Photo. Desktop toggles Fit and 100%; touch supports pinch. Previous/Next gestures are disabled while zoomed so they do not conflict with pan. Original Photo is never fetched automatically for zoom.

`Download original` is one User action in More. The application requests temporary Original Download access and starts the browser-supported download or file-open behaviour without displaying a second temporary-link step.

## Upload Tray

`Add photos` opens a non-blocking Upload Tray rather than a blocking modal or permanent upload page. The User can continue browsing while transfer and processing proceed, and can minimise the Tray.

Before upload, the Tray provides:

- desktop drag and drop plus an explicit file picker;
- mobile system photo/file selection;
- local JPEG/PNG previews when the browser can decode them;
- a clear format tile when HEIC/HEIF cannot be previewed locally;
- file name, size, and validation result;
- removal of individual selections;
- no manual reorder, because Captured At determines Timeline order.

Upload supports up to the existing 100-file Upload Batch boundary without decoding every full-size source simultaneously.

During upload, file rows distinguish browser transfer from server processing. The User may keep browsing. The Tray can recover a recently active Upload Batch after Original Photos finish transferring and server processing continues. It does not promise resumable browser transfer: leaving during active transfer warns the User, brief network interruption may receive limited automatic retry, and a fully interrupted file must be selected again.

Completion reports distinct outcomes:

- `12 added`
- `2 already in your album`
- `1 needs attention`

Exact Duplicate is presented as neutral `Already in your album`, not an error. When the API identifies the matching Ready Photo, the User can open it. Processing Failed alone contributes to `needs attention`.

New Ready Photos enter the Timeline period determined by Captured At. The current Timeline does not reflow or jump unexpectedly; Upload Tray offers `View new photos`.

## Archive

Archive is a separate destination, not a Timeline checkbox, filter, Trash, or deletion queue. It uses the same chronological presentation and Photo Viewer.

Archive Photo is immediate and reversible:

1. More → `Archive photo`.
2. The Photo leaves Timeline and Viewer advances to the next Photo.
3. Feedback says `Photo moved to Archive — Undo`.
4. Undo performs Restore Photo.
5. Archive remains the durable place to restore after Undo expires.

Permanent deletion is outside this design. If it is introduced later, it requires a separate retention policy and strong confirmation.

## Processing Issues

Processing Issues is visible in navigation only while at least one Processing Issue is open. It includes a count and is also linked from Upload Tray completion when attention is needed.

An issue row contains Original File Name, Added At, a User-comprehensible reason, and Retry Processing. Retrying keeps the issue open while the Photo is Processing. The issue resolves only when the Photo becomes Ready, at which point the UI may offer `View in timeline`.

When the last issue resolves, the current view shows a completion empty state. After leaving it, Processing Issues disappears from navigation. The view never exposes queues, processors, storage services, hashes, or infrastructure terminology.

## Sign-In and Session States

The signed-out screen contains no User Photos or stock family photography. It carries the visual system through light, typography, and restrained framing.

Suggested copy:

- `Open your album`
- `Private access for invited users.`

The first step asks only for Email Address. After requesting a Sign-In Code, the interface preserves the selected address as context and offers `Use a different email`. Errors must not reveal User Allowlist membership.

Loading Session uses the product's visual mark and a restrained static loading state rather than a bare sentence. Session expiry returns to Sign-In because the entire signed-in product is no longer usable.

## Empty, Loading, and Error States

An empty Personal Album retains the Album shell and presents one action:

```text
Your album is empty
Add your first photos to begin a timeline.
[ Add photos ]
JPEG, PNG and HEIC
```

It uses no illustration, fake thumbnails, or example family. While the first Photos process, it says `Preparing your first photos` and retains access to Upload Tray. If processing fails, it links to Processing Issues.

Errors belong to the failing scope and preserve unaffected content:

- incremental Timeline failure appears after the last loaded period with `Try again`;
- initial Timeline failure stays inside Timeline;
- one unavailable thumbnail remains a local placeholder;
- Viewer failure still permits Previous and Next;
- Archive and Restore failure keep the Photo in its current location;
- upload failure belongs to the affected file;
- Session failure returns to Sign-In.

Success feedback may disappear. Errors requiring action remain until resolved. Copy names the affected object and the next action; it does not say only `Something went wrong`.

## Interaction and Accessibility

- Core flows work at 320px width and with keyboard-only navigation.
- Interactive controls have visible focus and sufficient contrast.
- Timeline Photos use native private link semantics to open Viewer.
- Viewer supports Escape, left/right navigation, and predictable focus return.
- Touch targets are at least 44px.
- Reduced motion removes environment transitions and image fades.
- The interface never relies on hover alone for required information or action.
- Accessible labels express only known Captured At precision and do not invent visual descriptions.
- There is no custom Timeline arrow-key grid; native link navigation avoids a fragile spatial keyboard model across virtualised Justified Rows.

## Language Strategy

The first implementation remains English-only. UI messages are centralised rather than scattered across components, date rendering follows the selected UI locale without reinterpreting capture-local time, and layouts allow for future text expansion. The interface does not mix partial English and Chinese localisation.

## Deliberate Non-Goals

The design does not add:

- shared albums or cross-User browsing;
- Search or a placeholder Search box;
- folders, tags, faces, semantic indexing, or maps;
- multi-select or bulk actions;
- bulk export;
- permanent deletion;
- automatic camera roll sync;
- editing, cropping, filters, or Original Photo mutation;
- resumable browser file transfer;
- a public photo route or public Viewer link;
- a native app, PWA, or offline mode.

## Implementation Sequence

Personal Light Table is a cross-frontend/backend target experience. It must be delivered in dependency-aware slices rather than as a visual skin over the current behaviour.

### 1. Experience foundation

- app shell and private routes;
- colour, typography, spacing, focus, motion, and responsive tokens;
- redesigned Sign-In, Session loading, empty state, and scoped errors;
- centralised English UI messages.

### 2. Chronology and scale foundation

- capture-local time representation and migration strategy;
- Capture Time Offset and Captured At Precision contracts;
- Adjust Captured At domain/API design;
- stable cursor pagination and lightweight date index;
- Small and Large Timeline Thumbnail processing and backfill;
- Restore Photo and durable Processing Issues contracts.

### 3. Browsing tracer

- automatically loaded, month-grouped Justified Rows;
- desktop year index and mobile Jump to date;
- private Photo Viewer route with history and scroll restoration;
- responsive thumbnail selection, loading states, and 20,000-Photo performance validation.

### 4. Supporting workflows

- Upload Tray with local preview, minimise, recovery boundary, and completion summary;
- Archive view, Restore, and Undo;
- conditional Processing Issues navigation and Retry lifecycle;
- single-action Original Download.

### 5. Refinement and acceptance

- mobile gesture and zoom/pan validation;
- keyboard, focus, screen-reader, reduced-motion, and contrast checks;
- failure, expired-access, long-text, partial-date, and empty-period scenarios;
- production smoke tests with real JPEG, PNG, and HEIC Photos.

Exact endpoint shapes, cursor encoding, route library, virtualisation library, thumbnail backfill mechanism, and component boundaries remain implementation decisions. They must preserve this accepted experience and the canonical domain language.
