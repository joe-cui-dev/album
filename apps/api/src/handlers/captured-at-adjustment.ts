import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { validateCapturedAt, type CapturedAtAdjustmentRequest, type CapturedAtAdjustmentResponse } from "@album/shared";
import type { AuthedContext } from "../auth-wrapper.js";
import { withAuth } from "../configured-auth.js";
import { badRequest, json, ok } from "../http.js";
import { chronologyETagHeader, toPhotoDetail } from "./photo-actions.js";
import { mapConcurrentModificationError } from "./mutation-errors.js";
import { StaleChronologyRevisionError } from "../store/errors.js";

export const adjustCapturedAtHandler: APIGatewayProxyHandlerV2 = withAuth((context, event) =>
  handleAdjustCapturedAt({
    ...context,
    photoId: event.pathParameters?.photoId,
    ifMatch: event.headers?.["if-match"],
    body: event.body,
  }),
);

export const revertCapturedAtHandler: APIGatewayProxyHandlerV2 = withAuth((context, event) =>
  handleRevertCapturedAt({
    ...context,
    photoId: event.pathParameters?.photoId,
    ifMatch: event.headers?.["if-match"],
  }),
);

export const handleAdjustCapturedAt = async ({
  album,
  photoId,
  ifMatch,
  body,
}: AuthedContext & {
  photoId: string | undefined;
  ifMatch: string | undefined;
  body: string | undefined;
}): Promise<APIGatewayProxyStructuredResultV2> => {
  if (!photoId) {
    return badRequest("photoId is required");
  }
  const expectedRevision = parseIfMatchRevision(ifMatch);
  if (expectedRevision === "missing") {
    return json(428, { message: "If-Match is required" });
  }
  if (expectedRevision === "invalid") {
    return badRequest("If-Match must be a quoted integer revision");
  }
  if (!body) {
    return badRequest("Missing request body");
  }

  const request = parseJson<CapturedAtAdjustmentRequest>(body);
  const validationErrors = validateCapturedAt(request.capturedAt);
  if (validationErrors.length > 0) {
    return badRequest(`capturedAt is invalid: ${validationErrors.map((error) => error.message).join(", ")}`);
  }

  const photo = await album.getPhoto(photoId);
  if (!photo) {
    return json(404, { message: "Photo not found" });
  }
  if (photo.processingState !== "ready" || !photo.chronology) {
    return json(409, { message: "Photo is not Ready" });
  }

  try {
    await album.replaceActiveChronologyV2({ photoId, capturedAt: request.capturedAt, expectedRevision });
  } catch (error) {
    return mapChronologyError(error);
  }

  const updated = await album.getPhoto(photoId);
  return ok(toPhotoDetail(updated!) satisfies CapturedAtAdjustmentResponse, {
    headers: chronologyETagHeader(updated!),
  });
};

export const handleRevertCapturedAt = async ({
  album,
  photoId,
  ifMatch,
}: AuthedContext & {
  photoId: string | undefined;
  ifMatch: string | undefined;
}): Promise<APIGatewayProxyStructuredResultV2> => {
  if (!photoId) {
    return badRequest("photoId is required");
  }
  const expectedRevision = parseIfMatchRevision(ifMatch);
  if (expectedRevision === "missing") {
    return json(428, { message: "If-Match is required" });
  }
  if (expectedRevision === "invalid") {
    return badRequest("If-Match must be a quoted integer revision");
  }

  const photo = await album.getPhoto(photoId);
  if (!photo) {
    return json(404, { message: "Photo not found" });
  }
  if (photo.processingState !== "ready" || !photo.chronology) {
    return json(409, { message: "Photo is not Ready" });
  }

  try {
    await album.revertActiveChronologyV2({ photoId, expectedRevision });
  } catch (error) {
    return mapChronologyError(error);
  }

  const updated = await album.getPhoto(photoId);
  return ok(toPhotoDetail(updated!) satisfies CapturedAtAdjustmentResponse, {
    headers: chronologyETagHeader(updated!),
  });
};

const mapChronologyError = (error: unknown): APIGatewayProxyStructuredResultV2 => {
  if (error instanceof StaleChronologyRevisionError) {
    return json(412, { message: "The Photo's chronology has changed; refresh and try again" });
  }
  return mapConcurrentModificationError(error);
};

/** Accepts a quoted or bare integer revision; distinguishes an absent header from a malformed one. */
const parseIfMatchRevision = (ifMatch: string | undefined): number | "missing" | "invalid" => {
  if (ifMatch === undefined || ifMatch === "") {
    return "missing";
  }
  const unquoted = ifMatch.replace(/^"|"$/g, "");
  const revision = Number(unquoted);
  return Number.isInteger(revision) && revision >= 0 ? revision : "invalid";
};

const parseJson = <T>(body: string): T => {
  try {
    return JSON.parse(body) as T;
  } catch {
    return {} as T;
  }
};
