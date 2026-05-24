import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { ok } from "../http.js";

export const handler: APIGatewayProxyHandlerV2 = async () => {
  return ok({ signedIn: false });
};

