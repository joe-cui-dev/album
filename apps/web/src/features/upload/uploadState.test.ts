import type { ProcessingState } from "@album/shared";
import { describe, expect, it } from "vitest";
import { isTerminalProcessingState } from "./uploadState.js";

describe("isTerminalProcessingState", () => {
  it.each<ProcessingState>(["ready", "processingFailed", "exactDuplicate"])(
    "treats %s as terminal",
    (state) => {
      expect(isTerminalProcessingState(state)).toBe(true);
    },
  );

  it.each<ProcessingState>(["uploadRequested", "processing"])(
    "treats %s as non-terminal",
    (state) => {
      expect(isTerminalProcessingState(state)).toBe(false);
    },
  );
});
