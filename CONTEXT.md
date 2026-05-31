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
A User who is no longer permitted to sign in. Removing a User from the User Allowlist does not delete that User's Personal Album or photos.
_Avoid_: deleted user, erased account, purged album

**App Administrator**:
Operational responsibility for deploying and maintaining the app. An App Administrator is not a product role for browsing or managing other Users' Personal Albums.
_Avoid_: super user, admin gallery, moderator

**Personal Album**:
A private album belonging to exactly one User. In the first version, a Personal Album is the User's private photo space, not a separate object the User creates, names, shares, or deletes.
_Avoid_: shared album, social album, workspace, album collection

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

**Timeline Thumbnail Size**:
The target sizing rule used when creating a Timeline Thumbnail from an Original Photo. The first version limits the longest edge to 320 pixels while preserving the image's aspect ratio and does not enlarge smaller photos.
_Avoid_: icon size, preview size

**Display Access**:
A temporary grant for a signed-in User to view one of their own Display Photos. Display Access does not make Display Photos publicly browsable.
_Avoid_: public image URL, static public photo, shared photo link

**Display Size**:
The target sizing rule used when creating a Display Photo from an Original Photo. The first version limits the longest edge to 2048 pixels while preserving the image's aspect ratio and does not enlarge smaller photos.
_Avoid_: thumbnail size, preview size

**Captured At**:
The moment a photo was taken. Prefer the photo's EXIF timestamp when available; it is distinct from when the photo was uploaded.
_Avoid_: uploaded at, created at

**Captured At Source**:
The origin of a photo's Captured At value. The fallback order is EXIF timestamp, then file modified time, then upload time.
_Avoid_: timestamp type, date source

**Timeline**:
The primary browsing view, where photos are ordered and grouped by Captured At.
_Avoid_: album list, gallery categories

**Timeline Filter**:
A simple condition that narrows which photos are visible in the Timeline, such as year, month, Processing State, or Archived Photo status.
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

**Upload Batch**:
A group of Original Photos selected and submitted by the User in one upload action.
_Avoid_: import job, folder sync

**Processing State**:
The state of a photo between upload and being ready to browse with its Display Photo and Timeline Thumbnail.
_Avoid_: job status, queue state

**Processing Failed**:
A Processing State where the Original Photo was uploaded but the Display Photo, Timeline Thumbnail, or Photo Metadata could not be created.
_Avoid_: broken upload, invalid photo

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
A photo hidden from the Timeline by the User while its Original Photo, Display Photo, and Photo Metadata are still preserved.
_Avoid_: deleted photo, trashed photo, removed image

**Protective Retention**:
Retention intended to recover from accidental deletion or accidental metadata changes. It is not the same as multi-region disaster recovery.
_Avoid_: backup, archive storage, disaster recovery

**Cost Guardrail**:
A limit, cleanup rule, or alert intended to reduce the risk of unexpected cloud costs for the whole app. In the first version, Cost Guardrails include a 50 MB maximum per Original Photo and 100 photos per Upload Batch; they are not per-User quotas.
_Avoid_: cost optimization, billing improvement, user quota

**Manual Upload**:
An upload started by the User selecting photo files in the web app.
_Avoid_: sync, backup, camera roll import

**Exact Duplicate**:
A User's Original Photo whose file contents match an Original Photo already in that same User's Personal Album.
_Avoid_: similar photo, near duplicate, duplicate-looking photo

**Supported Photo Format**:
A photo format the app accepts and can process into a Display Photo. The first version supports JPEG, PNG, and HEIC; it does not support RAW files, videos, or Live Photos. The frontend and API use MIME type and file extension as early validation, while processing success depends on whether the uploaded Original Photo can actually be decoded.
_Avoid_: media type, asset format

## Example Dialogue

Developer: "Can multiple people create accounts?"
Domain expert: "Yes. Each User has exactly one independent Personal Album."

Developer: "Can anyone on the internet register?"
Domain expert: "No. Only Allowed Users from the family allowlist can sign in."

Developer: "Can Users add other family members from inside the app?"
Domain expert: "No. The User Allowlist is changed operationally, not through in-app user management."

Developer: "If a User is removed from the User Allowlist, are their photos deleted?"
Domain expert: "No. A Removed User cannot sign in, but their Personal Album is not automatically deleted."

Developer: "Can one User sign in with multiple email addresses?"
Domain expert: "No. In the first version, one User corresponds to one allowlisted email address."

Developer: "Should we use the User's email address as the data key?"
Domain expert: "No. Use a stable User ID for ownership and keep Email Address as the login address."

Developer: "Can the app maintainer browse every family member's album?"
Domain expert: "No. The App Administrator is an operational responsibility, not an in-app role."

Developer: "Should we model users and tenants?"
Domain expert: "Model Users, but do not model shared tenants or workspaces."

Developer: "Can a User create multiple named albums?"
Domain expert: "No. Each User has exactly one Personal Album, and it is not managed as a separate named object."

Developer: "Do we keep the uploaded file after making a smaller web version?"
Domain expert: "Yes. The uploaded file is the Original Photo, and the web version is a Display Photo."

Developer: "Can the User export the whole album?"
Domain expert: "No. The first version only supports Original Download for one photo at a time."

Developer: "Can a User download another User's Original Photo by knowing its id or object key?"
Domain expert: "No. Original Download is temporary and scoped to the signed-in User."

Developer: "How many browsing versions should we create for each photo?"
Domain expert: "Create a Display Photo for detailed viewing and a Timeline Thumbnail for fast Timeline browsing."

Developer: "Should the main view show upload batches?"
Domain expert: "No. The main view is the Timeline, which follows when the photos were captured."

Developer: "What if a photo has no EXIF timestamp?"
Domain expert: "Use the Captured At fallback order and record the Captured At Source."

Developer: "Can the User search by objects, faces, or free text?"
Domain expert: "No. The first version uses Timeline Filters instead of search."

Developer: "Does phone support mean building a mobile app?"
Domain expert: "No. The first version supports Mobile Browsing in a phone browser."

Developer: "Can someone open a photo URL without signing in?"
Domain expert: "No. The album uses Private Access; public reachability does not mean public photos."

Developer: "Are Display Photos available at long-lived public URLs?"
Domain expert: "No. Display Access is temporary and scoped to the signed-in User."

Developer: "Does each User get a separate album URL?"
Domain expert: "No. Allowed Users enter through the Shared App Entry and are scoped by their session."

Developer: "Can new people register?"
Domain expert: "No. The User signs in with a Sign-In Code sent to their email."

Developer: "Is upload always one photo at a time?"
Domain expert: "No. The User can submit an Upload Batch, and each photo has a Processing State until its Display Photo and Timeline Thumbnail are ready."

Developer: "If processing fails, should we delete the uploaded file?"
Domain expert: "No. Mark it as Processing Failed and allow Retry Processing."

Developer: "Should we throw away camera and location metadata if the first UI does not use it?"
Domain expert: "No. Preserve Photo Metadata, but use Captured At as the Timeline driver."

Developer: "When the User removes a photo from the Timeline, is the file gone forever?"
Domain expert: "No. It becomes an Archived Photo unless the User later chooses a permanent deletion feature."

Developer: "Does the first version need full offsite backups?"
Domain expert: "No. It needs Protective Retention for accidental deletion and metadata mistakes."

Developer: "Can we rely on serverless alone to prevent surprise bills?"
Domain expert: "No. The app needs Cost Guardrails for uploads, logs, concurrency, and budget alerts."

Developer: "Does each User need their own upload quota?"
Domain expert: "No. The first version uses app-level Cost Guardrails, not per-User quotas."

Developer: "Will the app automatically upload new phone photos in the background?"
Domain expert: "No. The first version uses Manual Upload through the web app."

Developer: "Should two similar burst photos be treated as duplicates?"
Domain expert: "No. Only an Exact Duplicate is treated as a duplicate in the first version."

Developer: "If two family members upload the same photo, is the second one a duplicate?"
Domain expert: "No. Exact Duplicate checks are scoped to one User's Personal Album."

Developer: "Can the User upload videos or RAW files?"
Domain expert: "No. The first version only accepts Supported Photo Formats."
