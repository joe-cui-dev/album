import type { GetProcessingIssuesSummaryResponse, ListProcessingIssuesResponse } from "@album/shared";
import type { ProcessingIssuesPort } from "./processingIssuesPort.js";

interface Deferred<T> {
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export interface ListIssuesCall {
  cursor: string | undefined;
}

export interface TestProcessingIssuesPort {
  port: ProcessingIssuesPort;
  listIssuesCalls: ListIssuesCall[];
  getSummaryCalls: number;
  resolveNextListIssues(response: ListProcessingIssuesResponse): void;
  rejectNextListIssues(error: unknown): void;
  resolveNextGetSummary(response: GetProcessingIssuesSummaryResponse): void;
  rejectNextGetSummary(error: unknown): void;
}

/** A fully controllable `processingIssues` port for deep-module tests: every call queues until the test resolves it. */
export const createTestProcessingIssuesPort = (): TestProcessingIssuesPort => {
  const listIssuesCalls: ListIssuesCall[] = [];
  let getSummaryCalls = 0;
  const pendingListIssues: Array<Deferred<ListProcessingIssuesResponse>> = [];
  const pendingGetSummary: Array<Deferred<GetProcessingIssuesSummaryResponse>> = [];

  const port: ProcessingIssuesPort = {
    listIssues: ({ cursor, signal }) => {
      listIssuesCalls.push({ cursor });
      return new Promise((resolve, reject) => {
        pendingListIssues.push({ resolve, reject });
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    },
    getSummary: ({ signal }) => {
      getSummaryCalls += 1;
      return new Promise((resolve, reject) => {
        pendingGetSummary.push({ resolve, reject });
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    },
  };

  return {
    port,
    listIssuesCalls,
    get getSummaryCalls() {
      return getSummaryCalls;
    },
    resolveNextListIssues: (response) => pendingListIssues.shift()?.resolve(response),
    rejectNextListIssues: (error) => pendingListIssues.shift()?.reject(error),
    resolveNextGetSummary: (response) => pendingGetSummary.shift()?.resolve(response),
    rejectNextGetSummary: (error) => pendingGetSummary.shift()?.reject(error),
  };
};
