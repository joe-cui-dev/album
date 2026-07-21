import type { GetProcessingIssuesSummaryResponse, ListProcessingIssuesResponse } from "@album/shared";
import { albumTransport } from "../../lib/albumTransport.js";

/**
 * The Processing Issues view's owned internal network seam (ADR-0068).
 * Production gets an HTTP adapter, tests an in-memory or scripted one; the
 * deep module never imports the global HTTP client directly.
 */
export interface ProcessingIssuesPort {
  listIssues(input: { cursor?: string; signal: AbortSignal }): Promise<ListProcessingIssuesResponse>;

  getSummary(input: { signal: AbortSignal }): Promise<GetProcessingIssuesSummaryResponse>;
}

export const createHttpProcessingIssuesPort = (): ProcessingIssuesPort => ({
  listIssues: ({ cursor, signal }) => {
    const params = new URLSearchParams();
    if (cursor !== undefined) {
      params.set("cursor", cursor);
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return albumTransport.request(`/processing-issues${suffix}`, { signal });
  },

  getSummary: ({ signal }) => albumTransport.request("/processing-issues/summary", { signal }),
});
