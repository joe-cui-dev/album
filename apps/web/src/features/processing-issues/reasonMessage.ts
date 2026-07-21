import { uiMessages } from "../../lib/uiMessages.js";

/**
 * Maps a `ProcessingIssueReasonCode` to User-comprehensible copy, tolerating
 * an unrecognised code through one fallback message (implementation doc
 * "Shared reason codes"). Takes `string` rather than the narrowed union so a
 * server value the client doesn't yet recognise still renders instead of
 * failing to compile or crashing at runtime.
 */
export const messageForReasonCode = (reasonCode: string): string =>
  (uiMessages.processingReason as Record<string, string>)[reasonCode] ?? uiMessages.processingReason.unknown;
