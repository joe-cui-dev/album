import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ConcurrentPhotoModificationError } from "../store/errors.js";
import { json } from "../http.js";

/** Maps a concurrent-write conflict to 409; rethrows anything else for the caller to handle or propagate. */
export const mapConcurrentModificationError = (error: unknown): APIGatewayProxyStructuredResultV2 => {
  if (error instanceof ConcurrentPhotoModificationError) {
    return json(409, { message: "The Photo changed concurrently; refresh and try again" });
  }
  throw error;
};
