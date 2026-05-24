import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

export function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  };
}

export function ok(body: unknown): APIGatewayProxyStructuredResultV2 {
  return json(200, body);
}

export function badRequest(message: string): APIGatewayProxyStructuredResultV2 {
  return json(400, { message });
}

