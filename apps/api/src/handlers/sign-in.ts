import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { randomUUID } from "node:crypto";
import type {
  RequestSignInCodeRequest,
  RequestSignInCodeResponse,
  VerifySignInCodeRequest,
  VerifySignInCodeResponse,
} from "@album/shared";
import { findAllowedUserByEmail, normalizeEmail } from "../allowlist.js";
import { createSessionCookie } from "../auth.js";
import { config } from "../config.js";
import { badRequest, json, ok } from "../http.js";
import { guardMutationOrigin } from "../origin.js";
import { hashSignInCode } from "../sign-in-code-crypto.js";
import { signInChallengeStore } from "../store/configured-store.js";
import type { SignInChallengeStore } from "../store/sign-in-challenge.js";

const sqs = new SQSClient({});

interface RequestSignInCodeDeps {
  enqueueDispatch: (message: { requestId: string; email: string }) => Promise<void>;
  newRequestId: () => string;
}

interface VerifySignInCodeDeps {
  signInChallenges: SignInChallengeStore;
  now: () => Date;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const originError = guardMutationOrigin(event, config.webOrigins);
  if (originError) return originError;

  if (event.routeKey === "POST /session/sign-in-code") {
    return handleRequestSignInCode({ body: event.body, deps: requestSignInCodeDeps });
  }
  if (event.routeKey === "POST /session/verify") {
    return handleVerifySignInCode({ body: event.body, deps: verifySignInCodeDeps });
  }
  return json(404, { message: "Not found" });
};

const requestSignInCodeDeps: RequestSignInCodeDeps = {
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

const verifySignInCodeDeps: VerifySignInCodeDeps = {
  signInChallenges: signInChallengeStore,
  now: () => new Date(),
};

/**
 * Never checks the allowlist and always enqueues (ADR-0071: "check the allowlist only in the
 * worker"; non-allowed requests follow the same public admission path) -- the response is
 * identical whether or not the Email is Allowed.
 */
export const handleRequestSignInCode = async ({
  body,
  deps,
}: {
  body: string | undefined;
  deps: RequestSignInCodeDeps;
}): Promise<APIGatewayProxyStructuredResultV2> => {
  const request = parseJson<RequestSignInCodeRequest>(body);
  if (!request?.email) return badRequest("Email is required");

  await deps.enqueueDispatch({ requestId: deps.newRequestId(), email: normalizeEmail(request.email) });
  return ok({ accepted: true } satisfies RequestSignInCodeResponse);
};

/** A uniform 403 for every rejection reason (ADR-0071: "verification uses Email Address plus
 * Code and one generic invalid-or-expired result"). */
const invalidOrExpiredCode = (): APIGatewayProxyStructuredResultV2 =>
  json(403, { code: "sign_in_invalid", message: "Invalid or expired sign-in code" });

export const handleVerifySignInCode = async ({
  body,
  deps,
}: {
  body: string | undefined;
  deps: VerifySignInCodeDeps;
}): Promise<APIGatewayProxyStructuredResultV2> => {
  const request = parseJson<VerifySignInCodeRequest>(body);
  if (!request?.email || !request.code) return badRequest("Email and code are required");

  const email = normalizeEmail(request.email);
  const outcome = await deps.signInChallenges.recordAttempt({
    email,
    candidateHash: hashSignInCode(request.code),
    now: deps.now(),
  });
  if (outcome !== "consumed") return invalidOrExpiredCode();

  // The worker only ever dispatches to Allowed Emails; this can't normally miss, but stays
  // uniform with every other rejection path if the allowlist changed after dispatch.
  const user = findAllowedUserByEmail(email);
  if (!user) return invalidOrExpiredCode();

  return ok({ signedIn: true, user } satisfies VerifySignInCodeResponse, { cookies: [createSessionCookie(user)] });
};

const parseJson = <T>(body: string | undefined): T | undefined => {
  if (!body) return undefined;
  try {
    return JSON.parse(body) as T;
  } catch {
    return undefined;
  }
};
