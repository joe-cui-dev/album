import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { randomUUID } from "node:crypto";
import type {
  RequestSignInCodeV2Request,
  RequestSignInCodeV2Response,
  VerifySignInCodeV2Request,
  VerifySignInCodeV2Response,
} from "@album/shared";
import { findAllowedUserByEmail, normalizeEmail } from "../allowlist.js";
import { createSessionCookie } from "../auth.js";
import { config } from "../config.js";
import { badRequest, json, ok } from "../http.js";
import { guardMutationOrigin } from "../origin.js";
import { hashSignInCode } from "../sign-in-code-crypto.js";
import { signInDispatchStore } from "../store/configured-store.js";
import type { SignInDispatchStore } from "../store/sign-in-dispatch.js";

const sqs = new SQSClient({});

interface RequestSignInCodeV2Deps {
  enqueueDispatch: (message: { requestId: string; email: string }) => Promise<void>;
  newRequestId: () => string;
}

interface VerifySignInCodeV2Deps {
  signInDispatch: SignInDispatchStore;
  now: () => Date;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const originError = guardMutationOrigin(event, config.webOrigins);
  if (originError) return originError;

  if (event.routeKey === "POST /v2/session/sign-in-code") {
    return handleRequestSignInCodeV2({ body: event.body, deps: requestSignInCodeV2Deps });
  }
  if (event.routeKey === "POST /v2/session/verify") {
    return handleVerifySignInCodeV2({ body: event.body, deps: verifySignInCodeV2Deps });
  }
  return json(404, { message: "Not found" });
};

const requestSignInCodeV2Deps: RequestSignInCodeV2Deps = {
  newRequestId: randomUUID,
  enqueueDispatch: async (message) => {
    if (!config.signInDispatchQueueUrl) {
      throw new Error("Missing SIGN_IN_DISPATCH_QUEUE_URL");
    }
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: config.signInDispatchQueueUrl,
        MessageBody: JSON.stringify(message),
      }),
    );
  },
};

const verifySignInCodeV2Deps: VerifySignInCodeV2Deps = {
  signInDispatch: signInDispatchStore,
  now: () => new Date(),
};

/**
 * Never checks the allowlist and always enqueues (execution plan Slice 1.4: "check the
 * allowlist only in the worker"; "non-allowed messages are no-ops with the same public
 * admission path") -- the response is identical whether or not the Email is Allowed.
 */
export const handleRequestSignInCodeV2 = async ({
  body,
  deps,
}: {
  body: string | undefined;
  deps: RequestSignInCodeV2Deps;
}): Promise<APIGatewayProxyStructuredResultV2> => {
  const request = parseJson<RequestSignInCodeV2Request>(body);
  if (!request?.email) return badRequest("Email is required");

  await deps.enqueueDispatch({ requestId: deps.newRequestId(), email: normalizeEmail(request.email) });
  return ok({ accepted: true } satisfies RequestSignInCodeV2Response);
};

/** A uniform 403 for every rejection reason (execution plan Slice 1.4: "treat missing,
 * expired, wrong, exhausted, and non-allowed identically"). */
const invalidOrExpiredCode = (): APIGatewayProxyStructuredResultV2 =>
  json(403, { code: "sign_in_invalid", message: "Invalid or expired sign-in code" });

export const handleVerifySignInCodeV2 = async ({
  body,
  deps,
}: {
  body: string | undefined;
  deps: VerifySignInCodeV2Deps;
}): Promise<APIGatewayProxyStructuredResultV2> => {
  const request = parseJson<VerifySignInCodeV2Request>(body);
  if (!request?.email || !request.code) return badRequest("Email and code are required");

  const email = normalizeEmail(request.email);
  const outcome = await deps.signInDispatch.recordAttempt({
    email,
    candidateHash: hashSignInCode(request.code),
    now: deps.now(),
  });
  if (outcome !== "consumed") return invalidOrExpiredCode();

  // The worker only ever dispatches to Allowed Emails; this can't normally miss, but stays
  // uniform with every other rejection path if the allowlist changed after dispatch.
  const user = findAllowedUserByEmail(email);
  if (!user) return invalidOrExpiredCode();

  return ok({ signedIn: true, user } satisfies VerifySignInCodeV2Response, { cookies: [createSessionCookie(user)] });
};

const parseJson = <T>(body: string | undefined): T | undefined => {
  if (!body) return undefined;
  try {
    return JSON.parse(body) as T;
  } catch {
    return undefined;
  }
};
