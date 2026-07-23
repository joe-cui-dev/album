# Personal Light Table Design

Status: Accepted design baseline, refined 21 July 2026

Personal Light Table is the internal design direction for Personal Album. It reshapes the product as a quiet, photo-first place for one User to revisit their own memories. It does not change the ownership boundary: every User has one independent Personal Album and cannot browse another family User's Photos.

The canonical product language remains in [CONTEXT.md](../CONTEXT.md). Capture-local chronology and date precision are constrained by [ADR 0022](./adr/0022-preserve-capture-local-time.md), [ADR 0023](./adr/0023-preserve-captured-at-precision.md), [ADR 0025](./adr/0025-use-a-structured-captured-at-value.md), [ADR 0026](./adr/0026-use-upload-local-calendar-for-captured-at-fallbacks.md), and [ADR 0027](./adr/0027-preserve-one-original-and-one-active-captured-at.md). Timeline reads are constrained by [ADR 0028](./adr/0028-use-denormalized-timeline-projections.md), and responsive Timeline Thumbnail sizes by [ADR 0024](./adr/0024-generate-two-responsive-timeline-thumbnail-sizes.md).

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
| Exposure amber | `#925D1F` | Current year/month position and restrained photographic emphasis |
| Darkroom | `#101619` | Photo Viewer background |

Success, warning, and error colours are separate semantic tokens. Exposure amber does not become a generic button colour, and Emulsion blue does not become decoration. Borders and secondary text derive from Album ink mixed with the relevant surface.

Contrast-bearing derived tokens retain margin above their WCAG thresholds: muted normal text uses at least 66% Album ink, required interactive boundaries use at least 52% Album ink, and focus rings use solid Emulsion blue rather than a white mixture. The low-contrast 17% `line` token is decorative only and never the sole control boundary or state signal. Disabled controls use native disabled semantics and do not communicate unavailability through colour alone.

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

The Timeline is a cool, evenly lit surface. Photo Viewer transitions to Darkroom so one Photo can be viewed without peripheral glare. The transition is restrained and disabled when reduced motion is requested. Opening Viewer from a Timeline Thumbnail uses the View Transitions API to morph that one clicked Thumbnail into the Darkroom image; a browser without View Transitions, or reduced motion, falls back to an instant route change with no separate code path. Only Viewer entry carries this transition -- Previous/Next and Close remain plain navigation.

The app bar keeps the Album wordmark alone on the left, with Archive, Add photos, the conditional Processing Issues entry, and the User menu clustered together on the right rather than spread across the bar. The app bar, the desktop year index, and each month marker remain visible -- sticky, not merely present at load -- while the Timeline scrolls, with the year index and month markers offset to sit just below the app bar rather than under it.

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

Year jumping and disclosure are separate controls. At most one year is expanded, scrolling changes only the active styling, and an expanded year lists non-empty months newest first followed by Date unknown when present, with exact Photo counts.

### Mobile

The Timeline is full width with compact Justified Rows. The current month marker sticks below the app bar and yields to the next month. Selecting it opens a `Jump to date` bottom sheet containing only years and months that have Photos.

The bottom sheet uses the same period ordering as the desktop index: selecting a year expands its periods, while a separate `Latest in {year}` action jumps to that year's newest non-empty period.

The mobile bottom sheet is a true modal interaction: opening focuses its heading, makes the Album background inert, and traps focus until it closes. Selecting a period leaves the sheet open with a named loading state while the candidate Browsing Window loads. Success alone closes it, commits the URL, and focuses the Timeline or Archive heading; an empty-period conflict or other failure remains in the sheet for announcement, retry, or another selection. Close, Escape, or backdrop activation cancels the candidate request and restores focus to `Jump to date`. The desktop year index remains non-modal, and another selection cancels an earlier candidate.

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

The client initially requests 80 Photos and automatically requests one older cursor page at a time when completed layout comes within roughly two viewport heights of the visible end, requesting earlier when needed to complete a withheld row tail. It pauses speculative loading while hidden, offline, or inactive. Incremental failure exposes the retained Photo tail followed by one scoped retry; the Timeline has no permanent Load more control.

### Justified Rows

Timeline uses Justified Rows that preserve each Timeline Thumbnail's aspect ratio. Photos remain in chronological order from left to right and top to bottom. The design does not use square cropping or Masonry.

A period's short final row -- too few Photos to reach a full row at the target height -- justify-fills the row width like any other row instead of sitting left-aligned at a fixed height with unused width to its right. That enlargement is capped at 1.5x the target row height, so a lone narrow or portrait Photo is not stretched arbitrarily tall; a wide Photo's own natural fill height already lands under that cap unstretched.

No file name or date caption remains visible below a thumbnail. Hover and keyboard focus reveal a restrained capture date overlay. Touch opens Photo Viewer immediately. Accessible names include the known capture date and Original File Name without inventing unknown date components.

Timeline contains only Ready, non-archived Photos. It does not display Processing State badges.

### Chronology

Captured At is a capture-local calendar value and never shifts because the viewing browser changes time zone. A reliable Capture Time Offset is preserved separately when available. Missing offset does not mean UTC.

All Timeline, Viewer, accessible-name, and Info copy uses one structured Captured At formatter with compact, accessible, and detail presentations. It never parses the value as a browser-local instant, displays only components supported by Captured At Precision and Captured At Time Resolution, and shows a Capture Time Offset only when one is present.

Captured At supports four precision levels:

- Year
- Month
- Day
- Date and Time

Unknown values are not filled with January 1 or midnight. Month-, Day-, and Date-and-Time-precision Photos belong to their known month. Year-precision Photos appear after all known months in a `Date unknown` group for that year and use Added At, newest first, only to create a stable internal order.

Photo Viewer Info identifies Captured At Source. `Date from file` and `Date from upload` make fallbacks understandable without exposing implementation names.

All User-facing source copy comes from one mapping: EXIF is `Date from photo`, file modified time is `Date from file`, upload time is `Date from upload`, and a User adjustment is `Adjusted by you`. Viewer Info, adjustment and Revert states, and assistive announcements use these same labels without exposing storage or metadata identifiers.

The target experience includes `Adjust date and time`. Adjustment changes Timeline placement without rewriting the Original Photo, preserves Original Captured At, and can be reverted to that extracted value. Full date/time adjustment ships before partial-date authoring, while the data model continues to support Year, Month, and Day precision.

MVP includes the User-facing full date-and-time adjustment and Revert path. Viewer Info shows the active Captured At and a comprehensible Captured At Source; More opens `Adjust date and time`, and an adjusted Photo can be reverted to Original Captured At. Existing Year-, Month-, and Day-precision values must already render, group, and sort correctly, while authoring a new partial-precision value may follow after MVP. A successful change updates Viewer chronology, Timeline placement, and the Date Index without modifying the Original Photo.

The full editor requires Date and Time and exposes a secondary `UTC offset (optional)` field accepting an explicit `+HH:mm` or `-HH:mm` value between -12:00 and +14:00. It pre-fills an existing Capture Time Offset and otherwise stays blank; it never derives one from the browser, location, or a named time zone. Clearing the field removes the offset from the replacement value. Help copy tells the User to leave it blank when unknown because offset-free capture-local chronology remains valid.

`Time includes` explicitly selects Minutes, Seconds, or Fractions of a second. The saved local time contains exactly the selected detail: Minutes never invents `:00`, Seconds requires `HH:mm:ss`, and Fractions accepts one to six digits and canonicalises redundant trailing zeroes. Existing Date-and-Time values retain their Time Resolution on open. Existing partial values leave unknown Date and Time fields empty until the User supplies a complete replacement. Editing Date alone does not silently change Time, Time Resolution, or Capture Time Offset.

Adjustment opens from More as a named modal editor that makes the underlying Viewer inert and traps focus. Date receives initial focus; failed validation identifies and focuses the first invalid field. Save is single-flight and the editor stays open until success, then refreshes the Photo, announces the result, and returns focus to More. A pristine editor closes directly through Cancel, Escape, or Android/browser Back. A dirty editor handles those actions inside the same dialog with `Discard changes?`, `Keep editing`, and `Discard`; it does not stack another modal. The editor is not a shareable route, but device Back closes or resolves it before leaving Viewer.

If the chronology ETag is stale, the editor preserves the complete draft, reads and presents the latest Captured At and Source, and offers `Use latest` or `Keep my changes`. Use latest replaces the form and revision; Keep my changes retains the cohesive draft but adopts the latest revision so a later Save becomes an explicit overwrite. Date, Time, Time Resolution, and Capture Time Offset are never merged field by field. Conflict and network failure remain inside the editor without losing the draft; network failure provides Retry.

`Revert to original date and time` appears only when active chronology is a User adjustment that differs from Original Captured At. It opens the chronology modal in a confirmation state that shows Current, Original, and Original Source using their exact precision. Confirm uses the current ETag and follows the same stale-conflict path. Success keeps Viewer on the Photo while refreshing Info, neighbours, and any exact sequence position; collection Browsing Windows invalidate the old chronology placement. Closing later restores the originating window's stable anchor rather than holding the moved Photo at its former position. The confirmed Revert has no separate short-lived Undo; the User can Adjust again later.

### Thumbnail Loading

Photo processing produces private Small and Large Timeline Thumbnails at approximately 320px and 640px on the long edge. Timeline exposes both through responsive image sources; Photo Viewer uses Display Photo.

Correct aspect-ratio space is reserved before loading. Thumbnails use a static neutral placeholder and one 120–160ms decode fade. There is no shimmer. Reduced-motion mode removes the fade. Expired temporary access for visible thumbnails is refreshed without per-photo User retry.

Timeline and Archive renew visible access in single-flight batches of at most 100 when less than 60 seconds remains. A failed renewal retains an old source while it is still usable and retries with bounded backoff. Once access is unusable, only that Thumbnail becomes a static placeholder; coming online, returning to visibility, or reaching the retry window resumes automatic renewal without a per-Photo control or request storm. An authentication failure ends the Session rather than entering the renewal loop.

Timeline images use native width-descriptor `srcset` values from each source's actual dimensions and a `sizes` value from the computed Justified Row width. The first visible row receives higher fetch priority, other visible rows load eagerly, and overscan rows load lazily. The image is decorative inside a native Photo link whose accessible name combines Original File Name with only the known Captured At components. Access renewal or responsive source replacement never repeats the one-time decode fade.

## Photo Viewer

Photo Viewer is a full-screen Darkroom route. It fits the complete Display Photo without cropping and includes Close, Previous, Next, Info, More, and a sequence indicator. Browser Back returns to the previous Timeline position.

Default chrome shows only the Photo, its known capture date, and essential navigation. It is visible on Viewer entry, Photo change, and user input, then hides its controls, date, and sequence position after approximately three seconds without pointer or touch activity. It remains visible while Info or More is open, a gesture is active, or keyboard focus is within Viewer chrome. Pointer movement, touch start, keyboard input, or focus restores it. A Photo-area tap toggles chrome only if it does not become a swipe or pan. Visually hidden controls do not receive pointer input, while keyboard focus restores them before use and screen-reader button equivalents remain available. Reduced motion makes the visibility change immediate rather than disabling it.

After Viewer navigation succeeds, one atomic polite announcement identifies the new Photo by Original File Name, accessible Captured At using only known precision, and Viewer Sequence Position only when that position is exact. Button and gesture navigation produce the same announcement while focus remains on the triggering control for repeated operation. A load that lasts less than approximately 500ms does not announce an intermediate loading state; a longer load does. Failure is announced immediately without moving focus or removing available Previous and Next actions.

Info is secondary and contains, when available:

1. Captured At and Captured At Source
2. Camera Make, Model, and Lens
3. Dimensions, Format, and File Size
4. Original File Name
5. Location coordinates

Info is a named non-modal disclosure region inside Viewer, not another modal dialog. Its control exposes `aria-expanded` and `aria-controls`, retains focus when opened, and is followed by a `Photo information` region that screen readers can browse. Previous, Next, Zoom, and Close remain available. Info stays open and updates when Viewer moves to another Photo. Escape closes More first, then Info, and closes Viewer only when neither is open. Photo-area taps and downward gestures do not dismiss Info.

Viewer does not display `Ready`, because entry into Viewer already establishes that state. It does not infer a place name from coordinates.

Viewer supports limited zoom and pan against the 2048px Display Photo. Fit is the initial state. Desktop toggles between Fit and the Display Photo's intrinsic 100% size; touch pinch-zooms continuously from Fit up to that same intrinsic size and pans with one finger while enlarged. It does not magnify beyond the Display Photo's own pixels. Previous/Next gestures are disabled whenever the Photo is above Fit and become available again after returning to Fit. Moving to another Photo resets the Viewer to Fit. Double-tap zoom is not required for MVP, and the Original Photo is never fetched automatically for zoom.

A current Display Photo failure that may be caused by expired access triggers one automatic Viewer-bootstrap refresh. If that recovery fails, Viewer presents its scoped Retry while preserving Previous and Next. Authentication failure returns to Sign-In instead of retrying as an access-expiry problem.

Viewer chrome includes one 44px Zoom control on both desktop and touch layouts. At Fit its accessible name is `View at 100%` and it enlarges around the Photo centre; at any scale above Fit its name is `Fit to screen` and it returns directly to Fit. The native button is operable with Tab and Enter or Space, so additional zoom keyboard shortcuts are not required. Clicking or tapping the Photo itself does not toggle zoom.

`More` is a true action menu rather than a visually similar group of ordinary buttons. Enter, Space, or Arrow Down opens it and focuses the first available item; Arrow Up and Down cycle, Home and End move to the bounds, Escape closes and restores focus to `More`, and Tab or Shift+Tab closes before continuing the normal focus order. Clicking outside also closes it. Activating Archive, Restore, or Download closes the menu, and unavailable items are not focusable. Hidden menu items never remain in the Tab order.

Pinch zoom remains anchored at the gesture midpoint. Above Fit, one-finger pan is constrained independently on each axis so the Photo cannot be left beyond its valid edge; an axis whose rendered Photo is smaller than the viewport stays centred. Boundary resistance may provide feedback during a drag, but release always settles inside the valid range without extra Darkroom space. MVP pan stops on release and does not add inertial motion.

Viewport changes preserve Viewer intent. A Photo at Fit is recomputed and remains at Fit. A Photo above Fit retains its intrinsic scale and, as far as the new bounds allow, the same focal point at the viewport centre; the scale rises to the new Fit minimum when necessary and pan is clamped again. Device rotation, mobile browser chrome resizing, and desktop window resizing follow this same rule rather than resetting zoom.

At Fit, a one-finger horizontal drag that begins in the Photo area may navigate the Viewer; gestures beginning in Viewer controls, Info, or More do not. The current Photo follows the drag and returns to place if the gesture does not commit. A gesture commits when horizontal movement is dominant and either reaches 15% of the viewport width with a 48px minimum, or reaches approximately 0.5px/ms after at least 32px. Swiping left opens Next, the older Photo; swiping right opens Previous, the newer Photo. A sequence boundary rebounds without closing or wrapping. Navigation remains available when the current Photo fails to load, but any scale above Fit reserves one-finger drag for panning and disables swipe navigation.

`Download original` is one User action in More. The application requests temporary Original Download access and starts the browser-supported download or file-open behaviour without displaying a second temporary-link step.

Every Original Download action requests fresh access. A failure remains as actionable feedback with Retry; the application does not repeatedly initiate a browser download in the background.

## Upload Tray

`Add photos` opens a non-blocking Upload Tray rather than a blocking modal or permanent upload page. The User can continue browsing while transfer and processing proceed, and can minimise the Tray.

Upload Tray is a named non-modal dialog. Opening it moves focus into the Tray, but it does not declare `aria-modal`, trap focus, make the Album inert, or otherwise imply that the background is unavailable. Keyboard and screen-reader Users may leave the Tray to continue browsing while it remains open. The current implementation's modal ARIA declaration is an acceptance defect until it matches this non-blocking behaviour.

Opening or restoring Upload Tray focuses its programmatically focusable heading without adding that heading to the ordinary Tab sequence. Minimising moves focus to the persistent `Show upload progress` control; dismissing returns focus to the global `Add photos` control. Escape dismisses a Tray whose upload has not begun or whose Upload Batch is terminal, but minimises an active transfer or processing Tray without interrupting work. Completion actions that navigate focus the destination heading instead. While the non-modal Tray remains open, focus may move into and remain in the Album without being pulled back.

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

Assistive announcements describe Upload Batch milestones rather than every percentage or poll. Start announces the number of Photos being uploaded; completion of browser transfers announces the transition to processing; a file-specific transfer or processing failure is announced immediately by Original File Name; and terminal completion announces the complete added, already-in-album, and needs-attention summary atomically. Retry Processing announces its start and its eventual Ready or Exact Duplicate result by file name. Visible progress controls retain accurate names and values, while minimising or restoring Upload Tray neither interrupts these announcements nor repeats completed milestones.

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

An issue row contains Original File Name, Added At, a User-comprehensible reason, and Retry Processing. Retrying keeps the issue open while the Photo is Processing. The issue resolves when the Photo becomes Ready, at which point the UI may offer `View in timeline`, or when retry identifies an Exact Duplicate, at which point the UI reports `Already in your album` and may open the matching Ready Photo.

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

Success feedback without an action may disappear after approximately eight seconds. Feedback containing Undo, Retry, or another action remains until the User invokes it, explicitly dismisses it, or a newer result replaces it. Success uses a polite status announcement; failure uses an assertive alert and remains visible. Invoking an action leaves focus at a stable replacement feedback control or returns it to the prior page context rather than discarding focus. Archive remains the durable Restore path, but does not justify an inaccessible short Undo timer. Copy names the affected object and the next action; it does not say only `Something went wrong`.

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

Long User and metadata text remains intact in the domain data. Dense single-line surfaces such as Upload Tray rows and global navigation may use visual ellipsis while preserving the complete DOM text or accessible name; Viewer Info, Processing Issues, and error details wrap the full value with arbitrary break opportunities. A hover-only tooltip is never the sole full-text path. Feedback wraps inside the viewport, and at 320px plus 200% and 400% browser zoom no application surface creates two-dimensional page scrolling; an intentionally zoomed Photo may still pan. Acceptance fixtures include a 255-character unbroken Original File Name, CJK and right-to-left file names, a long Email Address, and long camera and lens metadata.

Reduced motion removes Timeline Thumbnail decode fades; Darkroom, chrome, sheet, Tray, and menu transitions; animated zoom changes; and animated rebound or re-clamping. Zoom, pan, and swipe still track the User's fingers directly because that motion communicates the active manipulation, but release settles immediately. Reduced motion does not change available functions, focus order, or status announcements, and the product adds no shimmer, parallax, or continuous decorative motion.

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
- read-only Archive browsing through the same Browsing Window;
- private Photo Viewer route with history and scroll restoration;
- responsive thumbnail selection, loading states, and 20,000-Photo performance validation.

The tracer's Photo Viewer includes the stable private route, direct-route loading, Fit display, Close, Previous, Next, known Captured At, a Viewer Sequence Position when it can be established exactly, keyboard navigation, read-only Info, scoped failures, Darkroom presentation, and restoration to the originating Browsing Window. Swipe, zoom and pan, idle chrome transitions, More actions, and their final mobile and accessibility validation remain in the later supporting-workflow and refinement slices.

Before replacing the legacy browsing UI, implementation separates its file selection, direct upload, Upload Batch polling, and Retry behaviour into a temporary Manual Upload workspace. The v2 Timeline, Archive, and Photo Viewer routes do not retain dependencies on the legacy filtered grid or detail panel. The later Upload Tray slice replaces the temporary workspace without changing the Browsing Window.

Tracer performance acceptance uses a synthetic 20,000-Photo Personal Album with mixed aspect ratios, extreme panoramas, partial Captured At values, and long Original File Names. After all compact descriptors have loaded, JavaScript heap growth over the signed-in empty baseline stays within 75 MiB; at most 250 Photo links or images are mounted; cursor reads remain single-flight; and Thumbnail Access renewal retains the 100-Photo batch boundary. Under 4x CPU slowdown, responsive re-layout plus anchor restoration has a p95 below 100ms, continuous scripted scrolling introduces no application long task above 50ms, and a displayed row never changes geometry because of pagination or image decode. Browser tests cover initial loading, incremental failure, Viewer opening, and Back restoration. These values change only in response to recorded measurements on representative target hardware.

### 4. Supporting workflows

- Upload Tray with local preview, minimise, recovery boundary, and completion summary;
- Archive Photo, Restore Photo, and Undo management flows on the existing Archive view;
- conditional Processing Issues navigation and Retry lifecycle;
- single-action Original Download.

### 5. Refinement and acceptance

This stage is the MVP acceptance gate, not a non-blocking polish backlog. Every criterion below must have a recorded result from automated verification, assisted manual verification, or the production smoke journey before the MVP is accepted. A promised behaviour that has not been implemented cannot pass by being marked untested; removing one from the gate requires an explicit change to the accepted design baseline.

- mobile gesture and zoom/pan validation;
- keyboard, focus, screen-reader, reduced-motion, and contrast checks;
- failure, expired-access, long-text, partial-date, and empty-period scenarios;
- production smoke tests with real JPEG, PNG, and HEIC Photos.

Work inside the gate proceeds in six dependency-ordered slices: establish the acceptance harness; close security and begin the auth-v2 observation window; complete Captured At Source, Adjust, and Revert; implement Viewer gestures, zoom, chrome, menu, Info, and announcements; close accessibility and resilience defects; then run candidate performance, assisted-device, production, auth-v1 removal, and dated acceptance. Roadmap status changes only after the final slice passes.

MVP acceptance also closes the roadmap's authentication and browser-request integrity gates: every protected request revalidates the User Allowlist so a Removed User cannot continue with an old Session, state-changing cookie-authenticated requests validate their browser Origin, and Sign-In Code request and verification controls resist abuse without revealing allowlist membership. CORS configuration and infrastructure alarms are supporting controls, not substitutes for these application checks.

Allowlist revalidation matches both User ID and Email Address on every protected API request, returns the generic authentication-loss response, and clears the cookie when the pair is no longer allowed. It stops new temporary grants immediately. As recorded in ADR 0070, an already issued private view or download grant retains at most its five-minute lifetime and an Upload grant at most fifteen minutes; MVP does not claim to revoke those S3 capabilities early. Production acceptance proves denial of API calls and new grants and records the bounded residual window.

Every API POST, PUT, PATCH, and DELETE validates a parseable browser Origin against the exact production Web origin or an explicitly configured development origin, including Sign-In Code request, verification, and Sign Out. Missing, opaque `null`, malformed, and merely similar origins receive the same generic forbidden response. URL parsing normalises host case and default ports before exact origin comparison; paths, credentials, suffixes, substrings, and wildcards do not match. GET and HEAD remain exempt while retaining Session and User isolation. Direct S3 PUT uses its separately scoped presigned capability. Production normally has no additional Web origin.

As recorded in ADR 0071, every syntactically valid Sign-In Code request returns the same accepted status and body before email delivery and enters a dedicated private queue. Its worker checks the User Allowlist and sends only to an Allowed User; other requests are no-ops with no public response or logging distinction. Verification uses the same invalid-or-expired result for a missing, expired, wrong, exhausted, or non-allowed credential. This prevents both response-shape and synchronous SES timing disclosure.

The public request response is only `{ accepted: true }`; Verify submits Email Address and Code without a public code ID. One normalised Allowed Email may receive at most one Code per 60 seconds and five in a rolling hour. A newly sent Code replaces the prior one, expires after ten minutes, permits at most five wrong attempts, and is consumed atomically on success. Application-level suppression still returns accepted. Dedicated API Gateway route throttles bound aggregate request cost at approximately one request per second with burst five, and Verify at five per second with burst ten. TTL-backed state stores Allowed-Email and attempt limits without raw source IP; private queue work derives a retry-stable Code from secret material and request identity instead of carrying replayable plaintext. Logs contain no Email Address, Code, or Code hash.

The no-code-ID contract deploys through additive v2 request and verify routes. The new Web client cuts over while v1 remains for a 24-hour observation window, longer than the ten-minute Code lifetime; v1 is then removed and stale tabs must refresh. Existing Session read and Sign Out remain unversioned and existing Sessions are not forced out by the migration. MVP acceptance begins only after v1 removal and v2 production security smoke.

Browser acceptance has an explicit evidence boundary. Automated critical-journey coverage runs in desktop Chromium, desktop Firefox, 320px WebKit, and 360px mobile Chromium. Real-device gesture acceptance uses the current stable Android Chrome on at least one physical Android phone; it covers pinch, pan, swipe navigation, sequence edges, rotation, system-edge conflicts, and mobile browser chrome resizing. Desktop production smoke covers current Chrome and Safari for Fit, 100%, resize, and keyboard operation. Real-device iOS Safari is not an MVP blocker because no test device is available: 320px WebKit smoke remains as a best-effort compatibility signal, but MVP acceptance does not claim that iOS Safari was production-verified. Each manual record identifies its date, operating system, device, and browser version; older browser releases are not an acceptance target.

Production security smoke proves one asynchronous Code delivery, single use and generic replay failure, cooldown without a second email, invalid-Origin rejection before mutation, cross-User read and write isolation, Removed-User rejection of an existing Session and new grants, and successful normal-origin journeys. The allowlist removal uses only a dedicated smoke User and may be reversed operationally after evidence is captured. Deterministic tests, not production attacks, exhaust hourly and attempt limits, TTL and consume races, every route's Origin matrix, queue retry and no-op behaviour, allowlist-pair revalidation, and temporary-grant lifetimes. Production never performs flooding or brute-force simulation and records no credential or private identifier.

The complete Sign-In, Timeline, Photo Viewer, Upload Tray, Archive, and Processing Issues journeys must meet WCAG 2.2 AA before MVP acceptance. Automated accessibility checks fail on every real violation regardless of reported impact. A documented tool false positive identifies its rule, selector, manual result, and rationale without a broad ignore; incomplete findings enter the manual checklist rather than passing automatically. Stable scans cover Sign-In and Session error, empty and populated collections, Viewer and its disclosures or chronology editor, every Upload Tray phase, Processing Issues and scoped errors, and the mobile date modal. Automation does not substitute for manual keyboard order, focus entry and return, modal isolation, dynamic status announcement, 200% and 400% browser zoom, reflow, contrast, and reduced-motion verification. Screen-reader walkthroughs judge the semantics that automated rules cannot. A known AA failure in a core journey blocks acceptance unless the accepted product baseline is explicitly changed.

Blocking screen-reader walkthroughs use current macOS VoiceOver with Safari for every core journey and current Android TalkBack with Chrome for the mobile journeys. Windows NVDA is not a blocker without an available Windows test environment and is recorded as not production-verified rather than assumed to pass. When TalkBack reserves touch gestures, the Photo area's direct swipe navigation need not remain available, but named Previous, Next, and Zoom buttons must provide the complete equivalent operation.

Partial-chronology verification is layered. Shared chronology and formatter tests exhaust every precision and Date-and-Time resolution, missing and boundary offsets, leap and calendar boundaries, every Captured At Source, ordering boundary, and stable tie-break. Browser tests represent every Captured At Precision across Timeline grouping, accessible and detail formatting, source copy, locale changes without calendar reinterpretation, browser-time-zone changes without movement, and Adjust or Revert across month, year, and Date unknown with matching Date Index counts. Empty-period races include the last Photo leaving through Archive, Adjust, or a concurrent action without committing broken history. Production uses a small set of real Photos for offset-bearing and offset-free EXIF, file-modified fallback, and one Adjust/Revert journey rather than repeating the combinatorial suite. Upload-time fallback remains covered in chronology, handler, and mock-browser tests because the current Manual Upload always supplies browser file-modified time; production smoke does not add a hidden path or forged request for an otherwise unreachable fallback.

Production smoke uses two dedicated Allowed Users backed by controlled test addresses, never family Album content. One owns the complete journey and the other proves it cannot read or mutate the first User's Photo. Fixtures are non-private and vary their bytes between repeated runs so Exact Duplicate does not bypass processing. Acceptance records omit addresses, Photo IDs, and temporary access values. Completed fixtures move to Archive through product behaviour; routine smoke never resets production data, and later permanent cleanup requires separate explicit approval.

A version-controlled production-smoke fixture pack contains small, non-private generated assets: JPEG with EXIF date/time and explicit offset, JPEG with EXIF date/time but no offset, PNG without EXIF for file-modified fallback, and a genuinely encoded HEIC. Its manifest records provenance, expected chronology, format signature, and SHA-256 without personal or device-identifying metadata. A verified tool creates byte-unique run variants without changing decode or expected metadata semantics; uploading one identical run variant again owns the Exact Duplicate check.

One deliberately undecodable JPEG fixture owns the production Processing Failed path. It has a valid JPEG name and browser media type but causes the processor to record `unsupportedImage` without an infrastructure failure. Smoke proves that it stays out of Timeline, creates one durable Processing Issue, enters retrying, returns to failed, and increments the same Issue rather than duplicating it. It is not expected to become Ready; automated tests own recoverable Ready and Exact Duplicate outcomes. The known Issue remains isolated in the smoke User, and testing never breaks Lambda, IAM, storage, or queues to create a failure.

MVP acceptance is established by a versioned template plus one dated run record under `docs/acceptance/`. The record identifies the deployed commit, time and environment; automation commands and results; fixture manifest and run hashes; browser, operating-system, Android-device, and screen-reader versions; and a Pass, Fail, or Blocked result with concise evidence for every gate. It omits test addresses, Photo IDs, access values, private screenshots, and other album data, and notes the non-blocking iOS and NVDA verification gaps. Only all blocking gates passing with no unresolved WCAG AA or production-journey defect permits the roadmap status to become Accepted. Later material releases add records rather than overwriting history.

`npm run verify:acceptance` is the single deterministic pre-production gate. It runs all workspace type checks, unit and handler tests, a production build, the blocking Playwright browser projects, automated accessibility scans, smoke-fixture signature/metadata/manifest verification, and CDK synthesis, failing non-zero on any stage. It never deploys, uploads, or reaches production. The dated record identifies the command result for its exact commit before separately recording assisted manual and production evidence.

Numeric scale performance is a separate blocking candidate-build gate, `npm run verify:performance`, because portable test machines cannot make its timing evidence interchangeable. On one recorded representative powered computer with fixed Playwright Chromium and 4x CPU throttling, it loads the full synthetic 20,000-Photo Album and measures the accepted heap, mounted-node, single-flight, renewal-batch, relayout p95, long-task, and stable-geometry limits. Mixed aspect ratios, extreme panoramas, partial dates, and long names are present. After warm-up it runs three times and every run must pass; the dated record retains hardware, OS, browser, and raw results. The command runs for a release candidate rather than every ordinary change.

Automated failure acceptance covers initial Session and collection reads; incremental cursors, Date Index, and date-jump candidates; individual Thumbnail, Display, and Original Download access; every User mutation; file validation, transfer, presign expiry, processing failure, and Exact Duplicate; plus concurrency, empty-period, collection-change, connectivity, and page-visibility races. Every case proves correct error scope, preservation of unaffected content and anchors, accessible announcement, convergent Retry or automatic recovery, and absence of duplicate mutations, request storms, or broken history entries. Handler and deep-module tests plus deterministic mock-API browser tests own this matrix; production does not manufacture every destructive condition.

Exact endpoint shapes, cursor encoding, route library, virtualisation library, thumbnail backfill mechanism, and component boundaries remain implementation decisions. They must preserve this accepted experience and the canonical domain language.
