# Personal Album

A private photo album for one person to upload, browse, and manage their own photos.

## Language

**Owner**:
The single person who owns the album. The Owner can upload, browse, and manage photos.
_Avoid_: User, customer, account

**Personal Album**:
A private album owned by exactly one Owner. It is not a multi-user or social photo sharing service.
_Avoid_: photo sharing platform, social album

**Original Photo**:
The photo file exactly as uploaded by the Owner, kept as the long-term source of truth.
_Avoid_: raw image, master image

**Original Download**:
An Owner action that grants temporary access to download one Original Photo.
_Avoid_: export, bulk download

**Display Photo**:
A smaller photo derived from an Original Photo for browsing in the web app.
_Avoid_: thumbnail, preview image

**Display Size**:
The target sizing rule used when creating a Display Photo from an Original Photo, such as limiting the longest edge while preserving the image's aspect ratio.
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
The access rule that only the Owner may view or manage album contents, even though the app is reachable from the public internet.
_Avoid_: public album, shared album

**Sign-In Code**:
A one-time code sent to the Owner's email address to prove access to the Personal Album.
_Avoid_: password, registration, invitation

**Upload Batch**:
A group of Original Photos selected and submitted by the Owner in one upload action.
_Avoid_: import job, folder sync

**Processing State**:
The state of a photo between upload and being ready to browse as a Display Photo.
_Avoid_: job status, queue state

**Processing Failed**:
A Processing State where the Original Photo was uploaded but the Display Photo or Photo Metadata could not be created.
_Avoid_: broken upload, invalid photo

**Retry Processing**:
An Owner action that tries to process a Processing Failed photo again while preserving the Original Photo.
_Avoid_: re-upload, repair

**Photo Metadata**:
Descriptive information read from an Original Photo, such as captured time, dimensions, camera details, and location data.
_Avoid_: file attributes, image info

**Location**:
The place where a photo was captured, usually represented by coordinates in Photo Metadata. Location may be preserved even when the app does not provide a map view.
_Avoid_: map, place page

**Archived Photo**:
A photo hidden from the Timeline by the Owner while its Original Photo, Display Photo, and Photo Metadata are still preserved.
_Avoid_: deleted photo, trashed photo, removed image

**Protective Retention**:
Retention intended to recover from accidental deletion or accidental metadata changes. It is not the same as multi-region disaster recovery.
_Avoid_: backup, archive storage, disaster recovery

**Cost Guardrail**:
A limit, cleanup rule, or alert intended to reduce the risk of unexpected cloud costs.
_Avoid_: cost optimization, billing improvement

**Manual Upload**:
An upload started by the Owner selecting photo files in the web app.
_Avoid_: sync, backup, camera roll import

**Exact Duplicate**:
An Original Photo whose file contents match an already uploaded Original Photo exactly.
_Avoid_: similar photo, near duplicate, duplicate-looking photo

**Supported Photo Format**:
A photo format the app accepts and can process into a Display Photo. The first version supports JPEG, PNG, and HEIC; it does not support RAW files, videos, or Live Photos.
_Avoid_: media type, asset format

## Example Dialogue

Developer: "Can multiple people create accounts?"
Domain expert: "No. This is one Personal Album for one Owner."

Developer: "Should we model users and tenants?"
Domain expert: "No. Use Owner when talking about the person who controls the album."

Developer: "Do we keep the uploaded file after making a smaller web version?"
Domain expert: "Yes. The uploaded file is the Original Photo, and the web version is a Display Photo."

Developer: "Can the Owner export the whole album?"
Domain expert: "No. The first version only supports Original Download for one photo at a time."

Developer: "How many web versions should we create for each photo?"
Domain expert: "The first version creates one Display Photo using the chosen Display Size."

Developer: "Should the main view show upload batches?"
Domain expert: "No. The main view is the Timeline, which follows when the photos were captured."

Developer: "What if a photo has no EXIF timestamp?"
Domain expert: "Use the Captured At fallback order and record the Captured At Source."

Developer: "Can the Owner search by objects, faces, or free text?"
Domain expert: "No. The first version uses Timeline Filters instead of search."

Developer: "Does phone support mean building a mobile app?"
Domain expert: "No. The first version supports Mobile Browsing in a phone browser."

Developer: "Can someone open a photo URL without signing in?"
Domain expert: "No. The album uses Private Access; public reachability does not mean public photos."

Developer: "Can new people register?"
Domain expert: "No. The Owner signs in with a Sign-In Code sent to their email."

Developer: "Is upload always one photo at a time?"
Domain expert: "No. The Owner can submit an Upload Batch, and each photo has a Processing State until its Display Photo is ready."

Developer: "If processing fails, should we delete the uploaded file?"
Domain expert: "No. Mark it as Processing Failed and allow Retry Processing."

Developer: "Should we throw away camera and location metadata if the first UI does not use it?"
Domain expert: "No. Preserve Photo Metadata, but use Captured At as the Timeline driver."

Developer: "When the Owner removes a photo from the Timeline, is the file gone forever?"
Domain expert: "No. It becomes an Archived Photo unless the Owner later chooses a permanent deletion feature."

Developer: "Does the first version need full offsite backups?"
Domain expert: "No. It needs Protective Retention for accidental deletion and metadata mistakes."

Developer: "Can we rely on serverless alone to prevent surprise bills?"
Domain expert: "No. The app needs Cost Guardrails for uploads, logs, concurrency, and budget alerts."

Developer: "Will the app automatically upload new phone photos in the background?"
Domain expert: "No. The first version uses Manual Upload through the web app."

Developer: "Should two similar burst photos be treated as duplicates?"
Domain expert: "No. Only an Exact Duplicate is treated as a duplicate in the first version."

Developer: "Can the Owner upload videos or RAW files?"
Domain expert: "No. The first version only accepts Supported Photo Formats."
