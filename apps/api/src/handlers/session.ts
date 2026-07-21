import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import type {
  GetSessionResponse,
  RequestSignInCodeRequest,
  RequestSignInCodeResponse,
  VerifySignInCodeRequest,
  VerifySignInCodeResponse,
} from "@album/shared";
import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { findAllowedUserByEmail, getAllowedUsers, normalizeEmail } from "../allowlist.js";
import { clearSessionCookie, createSessionCookie, getAuthenticatedUser } from "../auth.js";
import { config } from "../config.js";
import { badRequest, forbidden, json, ok } from "../http.js";
import { guardMutationOrigin } from "../origin.js";
import { signInCodeStore } from "../store/configured-store.js";
import type { SignInCodeStore } from "../store/sign-in-codes.js";

const ses = new SESv2Client({});

interface RequestSignInCodeDeps {
  signInCodes: SignInCodeStore;
  now: () => Date;
  generateCode: () => string;
  newCodeId: () => string;
  sendSignInCodeEmail: (input: { email: string; code: string }) => Promise<void>;
}

interface VerifySignInCodeDeps {
  signInCodes: SignInCodeStore;
  now: () => Date;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const originError = guardMutationOrigin(event, config.webOrigins);
  if (originError) return originError;

  if (event.routeKey === "GET /session") {
    const user = getAuthenticatedUser(event);
    if (!user) return ok({ signedIn: false } satisfies GetSessionResponse);

    const stillAllowed = getAllowedUsers().some(
      (allowedUser) => allowedUser.userId === user.userId && allowedUser.email === normalizeEmail(user.email),
    );
    if (!stillAllowed) {
      return ok({ signedIn: false } satisfies GetSessionResponse, { cookies: [clearSessionCookie()] });
    }

    return ok({ signedIn: true, user } satisfies GetSessionResponse);
  }
  if (event.routeKey === "DELETE /session") {
    return ok({ signedIn: false } satisfies GetSessionResponse, { cookies: [clearSessionCookie()] });
  }
  if (event.routeKey === "POST /session/sign-in-code") {
    return handleRequestSignInCode({ body: event.body, deps: requestSignInCodeDeps });
  }
  if (event.routeKey === "POST /session/verify") {
    return handleVerifySignInCode({ body: event.body, deps: verifySignInCodeDeps });
  }
  return json(404, { message: "Not found" });
};

const requestSignInCodeDeps: RequestSignInCodeDeps = {
  signInCodes: signInCodeStore,
  now: () => new Date(),
  generateCode: () => randomInt(100000, 1000000).toString(),
  newCodeId: randomUUID,
  sendSignInCodeEmail: async ({ email, code }) => {
    await ses.send(new SendEmailCommand({
      FromEmailAddress: config.sesFromEmail,
      Destination: { ToAddresses: [email] },
      Content: { Simple: { Subject: { Data: "Your album sign-in code" }, Body: { Text: { Data: `Your sign-in code is ${code}. It expires in ${Math.floor(config.signInCodeTtlSeconds / 60)} minutes.` } } } },
    }));
  },
};

const verifySignInCodeDeps: VerifySignInCodeDeps = {
  signInCodes: signInCodeStore,
  now: () => new Date(),
};

export const handleRequestSignInCode = async ({
  body,
  deps,
}: {
  body: string | undefined;
  deps: RequestSignInCodeDeps;
}): Promise<APIGatewayProxyStructuredResultV2> => {
  const request = parseJson<RequestSignInCodeRequest>(body);
  if (!request?.email) return badRequest("Email is required");

  const user = findAllowedUserByEmail(request.email);
  if (!user) {
    console.log(JSON.stringify({ level: "info", message: "Ignored sign-in code request for non-allowlisted email" }));
    return ok({ accepted: true } satisfies RequestSignInCodeResponse);
  }

  const code = deps.generateCode();
  const codeId = deps.newCodeId();
  const now = Math.floor(deps.now().getTime() / 1000);
  await deps.signInCodes.createSignInCode({
    email: user.email,
    codeId,
    userId: user.userId,
    codeHash: hashSignInCode(code),
    createdAt: new Date(now * 1000).toISOString(),
    expiresAt: now + config.signInCodeTtlSeconds,
  });
  if (config.sesFromEmail) {
    await deps.sendSignInCodeEmail({ email: user.email, code });
  } else {
    console.log(JSON.stringify({ level: "info", message: "Sign-in code created without SES_FROM_EMAIL", email: user.email, codeId, devCode: config.allowDevAuthCodes ? code : undefined }));
  }
  return ok({ accepted: true, codeId, ...(config.allowDevAuthCodes ? { devCode: code } : {}) } satisfies RequestSignInCodeResponse);
};

export const handleVerifySignInCode = async ({
  body,
  deps,
}: {
  body: string | undefined;
  deps: VerifySignInCodeDeps;
}): Promise<APIGatewayProxyStructuredResultV2> => {
  const request = parseJson<VerifySignInCodeRequest>(body);
  if (!request?.email || !request.codeId || !request.code) return badRequest("Email, codeId, and code are required");
  const email = normalizeEmail(request.email);
  const user = findAllowedUserByEmail(email);
  if (!user) return forbidden("Email is not allowlisted");

  const record = await deps.signInCodes.getSignInCode({ email, codeId: request.codeId });
  const now = Math.floor(deps.now().getTime() / 1000);
  if (!record || record.userId !== user.userId || record.expiresAt < now || !safeEqual(record.codeHash, hashSignInCode(request.code))) {
    return forbidden("Invalid or expired sign-in code");
  }
  await deps.signInCodes.deleteSignInCode({ email, codeId: request.codeId });
  return ok({ signedIn: true, user } satisfies VerifySignInCodeResponse, { cookies: [createSessionCookie(user)] });
};

function hashSignInCode(code: string): string {
  return createHash("sha256").update(config.sessionSigningSecret).update(":").update(code).digest("hex");
}

const safeEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

const parseJson = <T>(body: string | undefined): T | undefined => {
  if (!body) return undefined;
  try { return JSON.parse(body) as T; } catch { return undefined; }
};
