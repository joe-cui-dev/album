# Bound Noncurrent Photo Object Retention by Recoverability

The Photos bucket will keep S3 Versioning enabled while lifecycle rules permanently delete noncurrent Display Photos and Timeline Thumbnails after 30 days, transition noncurrent Original Photos to S3 Standard-IA after 30 days, and permanently delete noncurrent Original Photos after 90 days. This refines Protective Retention by giving reproducible browsing objects a shorter rollback window and irreplaceable originals a longer recovery window without retaining either forever; lifecycle cleanup never targets a current object version or a Deleted Photo still inside its Retention Window.

## Consequences

Recovery from an overwritten derived object remains possible for 30 days, and recovery from an overwritten Original Photo remains possible for 90 days. After those windows the affected noncurrent version is permanently unrecoverable. Standard-IA retrieval charges apply if an Original Photo is recovered after its first 30 noncurrent days.
