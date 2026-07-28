# Model Archive as Idempotent Membership

_Superseded by ADR-0075, which removes Archive in favour of Trash. The idempotent membership model recorded here is unchanged and now applies to `/photos/{photoId}/trash`._

Archive membership will use idempotent `PUT /photos/{photoId}/archive` and `DELETE /photos/{photoId}/archive` operations for Ready Photos, with the existing POST retained only during API migration. Each effective Archive or Restore transaction will update the authoritative `archived` state, move the denormalized projection between Active and Archived, and transfer its exact Date Index count without reprocessing or changing chronology; repeated requests already in the target collection succeed without another write. Server-side conditional retry will compose these membership changes with concurrent Captured At adjustment without requiring an archive-specific client ETag.
