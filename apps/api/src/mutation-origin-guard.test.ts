import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { trashMembershipHandler, restoreMembershipHandler } from "./handlers/trash-membership.js";
import { adjustCapturedAtHandler, revertCapturedAtHandler } from "./handlers/captured-at-adjustment.js";
import { handler as createUploadBatchHandler } from "./handlers/create-upload-batch.js";
import { originalDownloadUrlHandler } from "./handlers/photo-actions.js";
import { handler as retryProcessingHandler } from "./handlers/retry-processing.js";
import { handler as sessionHandler } from "./handlers/session.js";
import { handler as signInHandler } from "./handlers/sign-in.js";
import { handler as timelineThumbnailAccessHandler } from "./handlers/timeline-thumbnail-access.js";
import { permanentDeletionHandler } from "./handlers/permanent-deletion.js";
import { emptyTrashHandler } from "./handlers/empty-trash.js";

/**
 * Route-table coverage for the exact-Origin policy (execution plan Slice 1.1: "Add route-table
 * coverage that fails if a new mutation route is not guarded"). Every mutating (POST/PUT/PATCH/
 * DELETE) route registered in `infra/src/lib/album-stack.ts` must have its handler listed here.
 * If a new mutating route is added to the stack without adding it here, this file doesn't grow
 * on its own -- but if a handler is added here without wiring the guard (directly or via
 * `createWithAuth`), the assertion below catches the regression.
 */
const MUTATION_ROUTES: ReadonlyArray<{ name: string; method: string; handler: APIGatewayProxyHandlerV2; routeKey?: string }> = [
  { name: "PUT /photos/{photoId}/trash", method: "PUT", handler: trashMembershipHandler },
  { name: "DELETE /photos/{photoId}/trash", method: "DELETE", handler: restoreMembershipHandler },
  { name: "DELETE /photos/{photoId}", method: "DELETE", handler: permanentDeletionHandler },
  { name: "DELETE /trash", method: "DELETE", handler: emptyTrashHandler },
  { name: "PUT /photos/{photoId}/captured-at-adjustment", method: "PUT", handler: adjustCapturedAtHandler },
  { name: "DELETE /photos/{photoId}/captured-at-adjustment", method: "DELETE", handler: revertCapturedAtHandler },
  { name: "POST /upload-batches", method: "POST", handler: createUploadBatchHandler },
  { name: "POST /photos/{photoId}/original-download", method: "POST", handler: originalDownloadUrlHandler },
  { name: "POST /photos/{photoId}/retry-processing", method: "POST", handler: retryProcessingHandler },
  { name: "POST /timeline-thumbnail-access", method: "POST", handler: timelineThumbnailAccessHandler },
  { name: "DELETE /session", method: "DELETE", handler: sessionHandler, routeKey: "DELETE /session" },
  { name: "POST /session/sign-in-code", method: "POST", handler: signInHandler, routeKey: "POST /session/sign-in-code" },
  { name: "POST /session/verify", method: "POST", handler: signInHandler, routeKey: "POST /session/verify" },
];

describe("every mutating route rejects a disallowed Origin", () => {
  it.each(MUTATION_ROUTES.map((route) => [route.name, route] as const))("%s", async (_name, route) => {
    const event = {
      routeKey: route.routeKey,
      pathParameters: { photoId: "photo-1" },
      headers: { origin: "https://evil.example.com" },
      requestContext: { http: { method: route.method } },
      body: "{}",
    };
    const response = await route.handler(event as never, {} as never, jest.fn());
    expect(response).toMatchObject({
      statusCode: 403,
      body: JSON.stringify({ code: "origin_rejected", message: "Forbidden" }),
    });
  });
});
