import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import type { AlbumErrorCode } from "@album/shared";

export const json = (
  statusCode: number,
  body: unknown,
  extra?: Omit<APIGatewayProxyStructuredResultV2, "statusCode" | "body">,
): APIGatewayProxyStructuredResultV2 => {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      ...extra?.headers,
    },
    cookies: extra?.cookies,
    body: JSON.stringify(body),
  };
};

export const ok = (
  body: unknown,
  extra?: Omit<APIGatewayProxyStructuredResultV2, "statusCode" | "body">,
): APIGatewayProxyStructuredResultV2 => {
  return json(200, body, extra);
};

export const badRequest = (
  message: string,
): APIGatewayProxyStructuredResultV2 => {
  return json(400, { message });
};

export const unauthorized = (
  message = "Unauthorized",
  extra?: Omit<APIGatewayProxyStructuredResultV2, "statusCode" | "body">,
): APIGatewayProxyStructuredResultV2 => {
  return json(401, { message }, extra);
};

/** The generic 403 for a rejected `Origin` (execution plan Slice 1.1) -- deliberately free
 * of any detail about why, so a probe can't learn which Origins are close to allowed. */
export const originRejected = (): APIGatewayProxyStructuredResultV2 => {
  return json(403, { code: "origin_rejected", message: "Forbidden" });
};

/** A structured 409 carrying a stable machine-readable code alongside its diagnostic message. */
export const conflict = (
  code: AlbumErrorCode,
  message: string,
  extra?: Record<string, unknown>,
): APIGatewayProxyStructuredResultV2 => {
  return json(409, { code, message, ...extra });
};
