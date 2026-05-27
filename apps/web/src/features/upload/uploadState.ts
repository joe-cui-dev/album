import type { ProcessingState } from "@album/shared";

export const terminalProcessingStates: ProcessingState[] = [
  "ready",
  "processingFailed",
  "exactDuplicate",
];

export const isTerminalProcessingState = (state: ProcessingState): boolean =>
  terminalProcessingStates.includes(state);
