import type { SQSBatchResponse, SQSHandler } from "aws-lambda";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { findAllowedUserByEmail, normalizeEmail } from "../allowlist.js";
import { config } from "../config.js";
import { deriveSignInCode, hashSignInCode } from "../sign-in-code-crypto.js";
import { signInChallengeStore } from "../store/configured-store.js";
import type { SignInChallengeStore } from "../store/sign-in-challenge.js";

const ses = new SESv2Client({});

interface DispatchRecord {
  messageId: string;
  body: string;
}

interface DispatchDeps {
  signInChallenges: SignInChallengeStore;
  now: () => Date;
  sendSignInCodeEmail: (input: { email: string; code: string }) => Promise<void>;
}

export const handler: SQSHandler = async (event) => {
  return handleDispatchBatch({
    records: event.Records,
    deps: {
      signInChallenges: signInChallengeStore,
      now: () => new Date(),
      sendSignInCodeEmail: async ({ email, code }) => {
        if (!config.sesFromEmail) {
          // No dev-code echo here: this worker has no request/response to carry one on,
          // and the public admission response never varies by allowlist membership anyway.
          console.log(JSON.stringify({ level: "info", message: "Sign-in code dispatched without SES_FROM_EMAIL" }));
          return;
        }
        await ses.send(
          new SendEmailCommand({
            FromEmailAddress: config.sesFromEmail,
            Destination: { ToAddresses: [email] },
            Content: {
              Simple: {
                Subject: { Data: "Your album sign-in code" },
                Body: { Text: { Data: `Your sign-in code is ${code}. It expires in ${Math.floor(config.signInCodeTtlSeconds / 60)} minutes.` } },
              },
            },
          }),
        );
      },
    },
  });
};

export const handleDispatchBatch = async ({
  records,
  deps,
}: {
  records: DispatchRecord[];
  deps: DispatchDeps;
}): Promise<SQSBatchResponse> => {
  const failures: Array<{ itemIdentifier: string }> = [];
  for (const record of records) {
    try {
      await handleDispatchMessage({ body: record.body, deps });
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        message: "Sign-in code dispatch record failed; returning it for SQS redelivery",
        messageId: record.messageId,
        error: error instanceof Error ? error.message : String(error),
      }));
      failures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failures };
};

const handleDispatchMessage = async ({ body, deps }: { body: string; deps: DispatchDeps }): Promise<void> => {
  const message = JSON.parse(body) as { requestId: string; email: string };
  const email = normalizeEmail(message.email);

  const allowedUser = findAllowedUserByEmail(email);
  if (!allowedUser) {
    // Deliberately silent and otherwise indistinguishable from an Allowed but rate-limited send.
    return;
  }

  const code = deriveSignInCode(message.requestId);
  const outcome = await deps.signInChallenges.tryDispatch({
    email,
    requestId: message.requestId,
    codeHash: hashSignInCode(code),
    now: deps.now(),
    codeTtlSeconds: config.signInCodeTtlSeconds,
  });
  if (!outcome.dispatched) return;

  await deps.sendSignInCodeEmail({ email, code });
};
