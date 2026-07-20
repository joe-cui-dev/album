# Personal Album

A private photo album service where each User has exactly one independent Personal Album.

## Language

**User**:
A person who has their own independent Personal Album. In the first version, one User corresponds to one allowlisted email address.
_Avoid_: owner, customer, account

**User ID**:
A stable identifier for a User used to associate photos, sessions, and album data with that User. A User ID is not the User's email address.
_Avoid_: email as id, owner id, account id

**Email Address**:
The login address used to send a Sign-In Code to an Allowed User. An Email Address identifies how the User signs in, not where their album data belongs.
_Avoid_: user id, primary key

**Allowed User**:
A User whose email address is permitted to sign in. The app is for a small family allowlist, not public registration.
_Avoid_: public user, subscriber, customer

**User Allowlist**:
The small set of family Users who are permitted to sign in. Changing the User Allowlist is an operational action, not an in-app self-service workflow.
_Avoid_: public registration, signup form, admin user management

**Removed User**:
A User who is no longer permitted to sign in or continue using an existing Session. Removing a User from the User Allowlist revokes access without deleting that User's Personal Album or Photos.
_Avoid_: deleted user, erased account, purged album

**App Administrator**:
Operational responsibility for deploying and maintaining the app. An App Administrator is not a product role for browsing or managing other Users' Personal Albums.
_Avoid_: super user, admin gallery, moderator

**Personal Album**:
A private album belonging to exactly one User. In the first version, a Personal Album is the User's private photo space, not a separate object the User creates, names, shares, or deletes.
_Avoid_: shared album, social album, workspace, album collection

**Personal Light Table**:
The internal product design concept for presenting one User's Personal Album as a quiet, photo-first space for revisiting their own memories. It is not a User-facing album name or navigation label, and “Personal” describes the ownership boundary rather than access to other family Users' Photos.
_Avoid_: Family Light Table, shared light table, family gallery, Light Table as UI label

**Photo**:
An entry in a Personal Album created when the User submits a file as part of an Upload Batch. A Photo exists even when its upload is incomplete, its processing fails, or it is identified as an Exact Duplicate; it does not necessarily appear in the Timeline.
_Avoid_: image file, timeline item, display image

**Original Photo**:
The photo file exactly as uploaded by the User, kept as the long-term source of truth.
_Avoid_: raw image, master image

**Original Download**:
A User action that grants temporary access for a signed-in User to download one of their own Original Photos.
_Avoid_: export, bulk download

**Display Photo**:
A smaller photo derived from an Original Photo for browsing in the web app. A Display Photo is oriented for normal viewing even when the Original Photo stores its orientation as metadata.
_Avoid_: preview image

**Timeline Thumbnail**:
A responsive Small or Large photo derived from an Original Photo for fast browsing in the Timeline without downloading the Display Photo. Timeline Thumbnails are private album content, not public or long-lived thumbnail URLs.
_Avoid_: public thumbnail, preview image

**Timeline Thumbnail Access**:
A temporary grant for a signed-in User to view responsive Timeline Thumbnails for one or more of their own Ready Photos. It may be renewed in a batch without making the underlying thumbnails public.
_Avoid_: public thumbnail URL, permanent image URL, per-photo login

**Display Access**:
A temporary grant for a signed-in User to view one of their own Display Photos. Display Access does not make Display Photos publicly browsable.
_Avoid_: public image URL, static public photo, shared photo link

**Captured At**:
The cohesive capture-local calendar value used to order and group a Photo in the Timeline. It contains only the components identified by Captured At Precision, may include a reliable Capture Time Offset for a known date and time, and identifies an absolute moment only when that offset is present.
_Avoid_: viewer-local time, uploaded at, created at

**Captured At Precision**:
The degree of calendar detail genuinely known for Captured At: Year, Month, Day, or Date and Time. Unknown components remain absent rather than being filled with invented defaults.
_Avoid_: approximate date, assumed January, assumed midnight

**Captured At Time Resolution**:
The degree of time-of-day detail genuinely known within Date-and-Time precision: Minute, Second, or Subsecond. It preserves finer known components without creating another Timeline calendar group or inventing zero seconds.
_Avoid_: additional date precision, assumed zero seconds

**Capture Time Offset**:
A reliable UTC offset explicitly paired with a Photo's Captured At value by the source metadata or the User. A missing or invalid Capture Time Offset does not mean UTC and must not be inferred from location, the viewing or uploading browser, file times, or other contextual clues.
_Avoid_: viewer time zone, assumed UTC, upload time zone

**Captured At Source**:
The origin of a Photo's active Captured At value: EXIF timestamp, file modified time, upload time, or User adjustment. Processing prefers EXIF original-image time, then EXIF digitized time, before using the file and upload fallbacks; those fallbacks use the uploading browser's local calendar context without claiming that its UTC offset is the Photo's Capture Time Offset.
_Avoid_: timestamp type, date source

**Added At**:
The moment a Photo was added to the Personal Album. It orders Photos that share the same known Captured At components or whose next calendar component is unknown, but it is never presented as the time the Photo was captured.
_Avoid_: Captured At, photo date

**Original Captured At**:
The immutable Captured At value and source first resolved during Photo processing. It is retained while the User adjusts the active Captured At value and provides the value restored by Revert Captured At.
_Avoid_: current date, edited EXIF

**Adjust Captured At**:
A User action that replaces the active capture-local value used to place a Photo in the Timeline while preserving Original Captured At and leaving the Original Photo unchanged. A replacement may use a different Captured At Precision.
_Avoid_: edit EXIF, change file date, re-upload

**Revert Captured At**:
A User action that replaces an adjusted Captured At with the Photo's immutable Original Captured At value and source.
_Avoid_: undo upload, re-extract metadata, edit EXIF

**Timeline**:
The primary continuous browsing view, where Ready Photos are ordered from newest to oldest and grouped by their known Captured At calendar period. At every date-precision and time-resolution boundary, Photos with a known next component appear newest first before Photos whose next component is unknown; ties use Added At and then Photo ID for deterministic order. Year-precision Photos appear after the year's known months under Date Unknown, and Photos in other Processing States do not appear.
_Avoid_: album list, gallery categories

**Timeline Navigation**:
A way for the User to jump to a year or month in the Timeline without treating that period as a search result or separate album.
_Avoid_: year filter, month filter, date search

**Browsing Window**:
The continuous portion of Timeline or Archive currently available to the User, beginning at the latest Photo or a Timeline Navigation anchor and extending toward older Photos. It is a view into the collection, not a filtered or saved subset.
_Avoid_: date results, loaded page, filtered timeline

**Photo Viewer**:
A focused view for looking at one Photo from the Timeline while retaining the ability to move between neighbouring Photos. Photo Metadata and management actions are secondary to viewing the Photo itself.
_Avoid_: photo detail panel, asset inspector, edit screen

**Viewer Sequence**:
The live chronological sequence of Ready Photos through which Photo Viewer moves, scoped to the originating Timeline or Archive. It is not a saved playlist or a snapshot, and it never crosses between Timeline and Archive.
_Avoid_: viewer history, loaded photos, slideshow playlist

**Viewer Sequence Position**:
A non-estimated Photo position within its live Viewer Sequence, shown only when a contiguous Browsing Window and exact Date Index can establish both the ordinal and collection total without observed inconsistency. It is not a collection snapshot and disappears when the client can no longer establish it reliably.
_Avoid_: loaded-item index, estimated position, persistent photo rank

**Mobile Browsing**:
Using the Personal Album from a phone browser to browse the Timeline, use the Photo Viewer, and perform Manual Upload.
_Avoid_: mobile app, PWA, offline mode

**Private Access**:
The access rule that only the User may view or manage album contents, even though the app is reachable from the public internet.
_Avoid_: public album, shared album

**Shared App Entry**:
The single web entry point used by every Allowed User. After sign-in, the User sees only their own Personal Album.
_Avoid_: per-user domain, public user page, user directory

**Sign-In Code**:
A one-time code sent to an Allowed User's email address to prove access to their Personal Album.
_Avoid_: password, registration, invitation

**Session**:
The temporary signed-in state created by verifying a Sign-In Code, carried by the User's browser and used to scope every request to that User's Personal Album.
_Avoid_: password login, API key, shared login

**Upload Batch**:
A group of Original Photos selected and submitted by the User in one upload action.
_Avoid_: import job, folder sync

**Upload Tray**:
The non-blocking workspace that shows file selection and the current Upload Batch while the User continues browsing their Personal Album. It may recover a recently active batch after Original Photos finish transferring and server processing remains underway, but it does not promise to resume an interrupted browser file transfer and is not durable Upload Batch history; failures that require later action belong in Processing Issues.
_Avoid_: upload modal, upload history, processing log

**Processing State**:
The durable lifecycle state of a Photo: Upload Requested, Processing, Ready, Processing Failed, or Exact Duplicate. Upload completion triggers processing but is not itself a Processing State.
_Avoid_: job status, queue state, Uploaded state

**Processing Failed**:
A Processing State where the Original Photo was uploaded but the Display Photo, Timeline Thumbnail, or Photo Metadata could not be created.
_Avoid_: broken upload, invalid photo

**Processing Issue**:
An independently durable, unresolved need for User attention created when a Photo first enters Processing Failed. It retains its identity while Retry Processing is underway and across failed attempts, then resolves when the Photo becomes Ready or an Exact Duplicate that needs no further User action.
_Avoid_: Processing State, error log, upload error

**Processing Issues**:
A durable, cursor-paginated view of a User's open Processing Issues so they remain discoverable and retryable after a page refresh or on another device. An exact open count controls whether it appears as a navigation destination; it is separate from the Timeline and is not a complete Upload Batch history.
_Avoid_: failed timeline, upload history, error log

**Retry Processing**:
A User action that tries to process a Processing Failed Photo again while preserving the Original Photo and keeping its Processing Issue open. The Issue resolves when the attempt makes the Photo Ready or identifies it as an Exact Duplicate.
_Avoid_: re-upload, repair

**Photo Metadata**:
Descriptive information read from an Original Photo, such as captured time, display dimensions, camera details, and location data.
_Avoid_: file attributes, image info

**Location**:
The place where a photo was captured, usually represented by coordinates in Photo Metadata. Location should be preserved when present in the Original Photo even when the app does not provide a map view.
_Avoid_: map, place page

**Archived Photo**:
A Photo hidden from the Timeline by the User while its Original Photo, browsing versions, and Photo Metadata remain preserved. It remains available in the Archive and can be returned to the Timeline with Restore Photo.
_Avoid_: deleted photo, trashed photo, removed image

**Archive Photo**:
A reversible User action that moves a Ready Photo out of the Timeline and into the Archive without deleting, reprocessing, or changing its chronology.
_Avoid_: delete photo, remove permanently, trash photo

**Archive**:
The private browsing view containing a User's Archived Photos, ordered and grouped by Captured At so they can be viewed or restored. The Archive is not a deletion queue or a Timeline Filter.
_Avoid_: trash, recycle bin, archived filter

**Restore Photo**:
A User action that returns an Archived Ready Photo to the default Timeline without recreating, reprocessing, or changing it. Restoring a Photo already in the Timeline has no additional effect.
_Avoid_: unarchive, recover deleted photo

**Protective Retention**:
Retention intended to recover from accidental deletion or accidental metadata changes. It is not the same as multi-region disaster recovery.
_Avoid_: backup, archive storage, disaster recovery

**Cost Guardrail**:
A limit, cleanup rule, or alert intended to reduce the risk of unexpected cloud costs for the whole app. Cost Guardrails are app-level protections rather than per-User quotas.
_Avoid_: cost optimization, billing improvement, user quota

**Manual Upload**:
An upload started by the User selecting photo files in the web app.
_Avoid_: sync, backup, camera roll import

**Exact Duplicate**:
A terminal Photo whose Original Photo has exactly the same file contents as a Ready Photo in the same User's Personal Album. It remains a separate retained Photo but does not receive browsing versions or appear in the Timeline; this outcome resolves any open Processing Issue and is described to the User as “Already in your album,” with a link to the matching Ready Photo when available.
_Avoid_: duplicate error, similar photo, near duplicate, duplicate-looking photo

**Supported Photo Format**:
A photo format the app accepts and can process into a Display Photo. The MVP supports JPEG, PNG, and HEIC; it does not support RAW files, videos, or Live Photos.
_Avoid_: media type, asset format
