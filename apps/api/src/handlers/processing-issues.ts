import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import type { ListProcessingIssuesResponse, ProcessingIssue } from "@album/shared";
import type { AuthedContext } from "../auth-wrapper.js";
import { withAuth } from "../configured-auth.js";
import { badRequest, ok } from "../http.js";
import type { ProcessingIssueRecord } from "../store/personal-album.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const NO_STORE_HEADERS = { "cache-control": "private, no-store" };

interface ProcessingIssuesCursor {
  v: 1;
  after: string;
}

const encodeCursor = (after: string): string =>
  Buffer.from(JSON.stringify({ v: 1, after } satisfies ProcessingIssuesCursor), "utf8").toString("base64url");

const decodeCursor = (value: string): ProcessingIssuesCursor | undefined => {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as Record<string, unknown>).v === 1 &&
      typeof (parsed as Record<string, unknown>).after === "string"
    ) {
      return parsed as ProcessingIssuesCursor;
    }
  } catch {
    // Invalid opaque cursor.
  }
  return undefined;
};

export const handler: APIGatewayProxyHandlerV2 = withAuth((context, event) =>
  handleListProcessingIssues({ ...context, query: event.queryStringParameters ?? {} }),
);

export const handleListProcessingIssues = async ({
  album,
  query,
}: AuthedContext & {
  query: { limit?: string; cursor?: string };
}): Promise<APIGatewayProxyStructuredResultV2> => {
  const limit = query.limit === undefined ? DEFAULT_LIMIT : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return badRequest(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
  if (query.cursor !== undefined && !cursor) {
    return badRequest("cursor is invalid");
  }
  const page = await album.queryProcessingIssuesV2({
    limit,
    ...(cursor ? { after: { sortKey: cursor.after } } : {}),
  });
  return ok(
    {
      issues: page.issues.map(toResponse),
      ...(page.lastSortKey ? { nextCursor: encodeCursor(page.lastSortKey) } : {}),
    } satisfies ListProcessingIssuesResponse,
    { headers: NO_STORE_HEADERS },
  );
};

const toResponse = (issue: ProcessingIssueRecord): ProcessingIssue => ({
  photoId: issue.photoId,
  fileName: issue.fileName,
  reasonCode: issue.reasonCode,
  status: issue.status,
  addedAt: issue.addedAt,
  firstOpenedAt: issue.firstOpenedAt,
  attemptCount: issue.attemptCount,
  lastAttemptAt: issue.lastAttemptAt,
});
