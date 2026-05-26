# Use Client File Modified Time for Captured At Fallback

The file modified time in the Captured At fallback order will come from the `fileModifiedAt` value supplied during Create Upload Batch and preserved on the Photo record and S3 object metadata. S3 object `LastModified` is not the User's device file modified time, so the processor will use upload time only when EXIF Captured At is unavailable and the client file modified time is missing or invalid.
