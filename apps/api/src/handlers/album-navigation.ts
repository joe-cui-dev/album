import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import type { AlbumNavigationResponse } from "@album/shared";
import type { AuthedContext } from "../auth-wrapper.js";
import { withAuth } from "../configured-auth.js";
import { ok } from "../http.js";

export const handler: APIGatewayProxyHandlerV2 = withAuth((context) =>
  handleGetAlbumNavigation(context),
);

export const handleGetAlbumNavigation = async ({
  album,
}: AuthedContext): Promise<APIGatewayProxyStructuredResultV2> => {
  const [timelineYears, archiveYears, processingIssueCount] = await Promise.all([
    album.listDateIndexYears("active"),
    album.listDateIndexYears("archived"),
    album.getProcessingIssuesSummary(),
  ]);

  return ok(
    {
      timeline: { years: timelineYears },
      archive: { years: archiveYears },
      processingIssueCount,
    } satisfies AlbumNavigationResponse,
    { headers: { "cache-control": "private, no-store" } },
  );
};
