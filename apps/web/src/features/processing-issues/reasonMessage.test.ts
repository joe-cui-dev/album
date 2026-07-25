import { describe, expect, it } from "vitest";
import { uiMessages } from "../../lib/uiMessages.js";
import { messageForReasonCode } from "./reasonMessage.js";

describe("messageForReasonCode", () => {
  it("maps every known reason code to its own message", () => {
    expect(messageForReasonCode("finalProcessingFailure")).toBe(uiMessages.processingReason.finalProcessingFailure);
    expect(messageForReasonCode("metadataMismatch")).toBe(uiMessages.processingReason.metadataMismatch);
    expect(messageForReasonCode("unsupportedImage")).toBe(uiMessages.processingReason.unsupportedImage);
  });

  it("falls back to the unknown message for an unrecognised code", () => {
    expect(messageForReasonCode("somethingNewFromTheServer")).toBe(uiMessages.processingReason.unknown);
  });
});
