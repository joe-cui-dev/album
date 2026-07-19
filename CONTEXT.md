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
A small photo derived from an Original Photo for fast browsing in the Timeline. A Timeline Thumbnail is private album content, not a public or long-lived thumbnail URL.
_Avoid_: public thumbnail, preview image

**Display Access**:
A temporary grant for a signed-in User to view one of their own Display Photos. Display Access does not make Display Photos publicly browsable.
_Avoid_: public image URL, static public photo, shared photo link

**Captured At**:
The moment a photo was taken. Prefer the photo's EXIF timestamp when available; it is distinct from when the photo was uploaded.
_Avoid_: uploaded at, created at

**Captured At Source**:
The origin of a photo's Captured At value. The fallback order is EXIF timestamp, then file modified time, then upload time.
_Avoid_: timestamp type, date source

**Timeline**:
The primary browsing view, where Ready Photos are ordered and grouped by Captured At. Photos in other Processing States do not appear in the Timeline.
_Avoid_: album list, gallery categories

**Timeline Filter**:
A simple condition that narrows which Ready Photos are visible in the Timeline by year, month, or Archived Photo status.
_Avoid_: search, discovery

**Mobile Browsing**:
Using the Personal Album from a phone browser to browse the Timeline, view photo details, and perform Manual Upload.
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

**Processing State**:
The durable lifecycle state of a Photo: Upload Requested, Processing, Ready, Processing Failed, or Exact Duplicate. Upload completion triggers processing but is not itself a Processing State.
_Avoid_: job status, queue state, Uploaded state

**Processing Failed**:
A Processing State where the Original Photo was uploaded but the Display Photo, Timeline Thumbnail, or Photo Metadata could not be created.
_Avoid_: broken upload, invalid photo

**Processing Issues**:
A durable view of a User's Processing Failed Photos so they remain discoverable and retryable after a page refresh or on another device. It is separate from the Timeline and is not a complete Upload Batch history.
_Avoid_: failed timeline, upload history, error log

**Retry Processing**:
A User action that tries to process a Processing Failed photo again while preserving the Original Photo. Retry Processing is only available for photos in the Processing Failed state.
_Avoid_: re-upload, repair

**Photo Metadata**:
Descriptive information read from an Original Photo, such as captured time, display dimensions, camera details, and location data.
_Avoid_: file attributes, image info

**Location**:
The place where a photo was captured, usually represented by coordinates in Photo Metadata. Location should be preserved when present in the Original Photo even when the app does not provide a map view.
_Avoid_: map, place page

**Archived Photo**:
A Photo hidden from the default Timeline by the User while its Original Photo, browsing versions, and Photo Metadata remain preserved. An Archived Photo can be returned to the default Timeline with Restore Photo.
_Avoid_: deleted photo, trashed photo, removed image

**Restore Photo**:
A User action that returns an Archived Photo to the default Timeline without recreating or reprocessing it.
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
A terminal Photo whose Original Photo has exactly the same file contents as a ready Photo in the same User's Personal Album. It remains a separate retained Photo but does not receive browsing versions or appear in the Timeline.
_Avoid_: similar photo, near duplicate, duplicate-looking photo

**Supported Photo Format**:
A photo format the app accepts and can process into a Display Photo. The MVP supports JPEG, PNG, and HEIC; it does not support RAW files, videos, or Live Photos.
_Avoid_: media type, asset format
