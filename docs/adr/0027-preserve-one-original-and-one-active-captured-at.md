# Preserve One Original and One Active Captured At

Each processed Photo will retain one immutable Original Captured At value and source alongside one active Captured At value and source. Adjust Captured At replaces the complete active value, marks its source as User adjustment, and may change precision; Revert Captured At restores the original value and source. The first version will not embed adjustment history in the Photo, keeping the write model small while preserving a trustworthy reset point and leaving event-based audit history as a future extension.
