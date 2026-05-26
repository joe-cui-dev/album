import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  GetSessionResponse,
  RequestSignInCodeRequest,
  RequestSignInCodeResponse,
  VerifySignInCodeRequest,
  VerifySignInCodeResponse,
} from "@album/shared";
import {
  createHash,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { findAllowedUserByEmail, normalizeEmail } from "../allowlist.js";
import {
  clearSessionCookie,
  createSessionCookie,
  getAuthenticatedUser,
} from "../auth.js";
import { config } from "../config.js";
import { badRequest, forbidden, json, ok } from "../http.js";

const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ses = new SESv2Client({});

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const route = event.routeKey;

  if (route === "GET /session") {
    const user = getAuthenticatedUser(event);
    return ok(
      user
        ? ({ signedIn: true, user } satisfies GetSessionResponse)
        : ({ signedIn: false } satisfies GetSessionResponse),
    );
  }

  if (route === "DELETE /session") {
    return ok({ signedIn: false } satisfies GetSessionResponse, {
      cookies: [clearSessionCookie()],
    });
  }

  if (route === "POST /session/sign-in-code") {
    return requestSignInCode(event.body);
  }

  if (route === "POST /session/verify") {
    return verifySignInCode(event.body);
  }

  return json(404, { message: "Not found" });
};

const requestSignInCode = async (body: string | undefined) => {
  const request = parseJson<RequestSignInCodeRequest>(body);
  if (!request?.email) {
    return badRequest("Email is required");
  }

  const user = findAllowedUserByEmail(request.email);
  if (!user) {
    console.log(
      JSON.stringify({
        level: "info",
        message: "Ignored sign-in code request for non-allowlisted email",
      }),
    );
    return ok({ accepted: true } satisfies RequestSignInCodeResponse);
  }

  const code = randomInt(100000, 1000000).toString();
  const codeId = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + config.signInCodeTtlSeconds;

  await dynamodb.send(
    new PutCommand({
      TableName: config.metadataTableName,
      Item: {
        pk: `SIGNIN#${user.email}`,
        sk: `CODE#${codeId}`,
        userId: user.userId,
        email: user.email,
        codeHash: hashSignInCode(code),
        createdAt: new Date(now * 1000).toISOString(),
        expiresAt,
      },
    }),
  );

  if (config.sesFromEmail) {
    await sendSignInCode(user.email, code);
  } else {
    console.log(
      JSON.stringify({
        level: "info",
        message: "Sign-in code created without SES_FROM_EMAIL",
        email: user.email,
        codeId,
        devCode: config.allowDevAuthCodes ? code : undefined,
      }),
    );
  }

  const response: RequestSignInCodeResponse = {
    accepted: true,
    codeId,
    ...(config.allowDevAuthCodes ? { devCode: code } : {}),
  };

  return ok(response);
};

const verifySignInCode = async (body: string | undefined) => {
  const request = parseJson<VerifySignInCodeRequest>(body);
  if (!request?.email || !request.codeId || !request.code) {
    return badRequest("Email, codeId, and code are required");
  }

  const email = normalizeEmail(request.email);
  const user = findAllowedUserByEmail(email);
  if (!user) {
    return forbidden("Email is not allowlisted");
  }

  const result = await dynamodb.send(
    new GetCommand({
      TableName: config.metadataTableName,
      Key: {
        pk: `SIGNIN#${email}`,
        sk: `CODE#${request.codeId}`,
      },
    }),
  );

  const item = result.Item;
  const now = Math.floor(Date.now() / 1000);
  if (
    !item ||
    item.userId !== user.userId ||
    typeof item.codeHash !== "string" ||
    typeof item.expiresAt !== "number" ||
    item.expiresAt < now ||
    !safeEqual(item.codeHash, hashSignInCode(request.code))
  ) {
    return forbidden("Invalid or expired sign-in code");
  }

  await dynamodb.send(
    new DeleteCommand({
      TableName: config.metadataTableName,
      Key: {
        pk: `SIGNIN#${email}`,
        sk: `CODE#${request.codeId}`,
      },
    }),
  );

  return ok(
    {
      signedIn: true,
      user,
    } satisfies VerifySignInCodeResponse,
    {
      cookies: [createSessionCookie(user)],
    },
  );
};

const sendSignInCode = async (email: string, code: string): Promise<void> => {
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: config.sesFromEmail,
      Destination: {
        ToAddresses: [email],
      },
      Content: {
        Simple: {
          Subject: {
            Data: "Your album sign-in code",
          },
          Body: {
            Text: {
              Data: `Your sign-in code is ${code}. It expires in ${Math.floor(
                config.signInCodeTtlSeconds / 60,
              )} minutes.`,
            },
          },
        },
      },
    }),
  );
};

function hashSignInCode(code: string): string {
  return createHash("sha256")
    .update(config.sessionSigningSecret)
    .update(":")
    .update(code)
    .digest("hex");
}

const safeEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
};

const parseJson = <T>(body: string | undefined): T | undefined => {
  if (!body) {
    return undefined;
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    return undefined;
  }
};
