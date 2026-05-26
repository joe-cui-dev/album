import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

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
): APIGatewayProxyStructuredResultV2 => {
  return json(401, { message });
};

export const forbidden = (
  message = "Forbidden",
): APIGatewayProxyStructuredResultV2 => {
  return json(403, { message });
};
