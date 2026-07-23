import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { ActiveSignInCredential, AttemptOutcome, SignInDispatchStore } from "./sign-in-dispatch.js";
import { MAX_WRONG_ATTEMPTS, RATE_LIMIT_COOLDOWN_SECONDS, RATE_LIMIT_MAX_PER_HOUR, RATE_LIMIT_WINDOW_SECONDS } from "./sign-in-dispatch.js";

const credentialKey = (email: string) => ({ pk: `SIGNIN2#${email}`, sk: "CREDENTIAL" });

/** `codeHash`/`expiresAt`/`wrongAttempts` all still need to be readable on a consumed
 * record (redelivery recognition, rate-limit history), so consuming sets this flag rather
 * than deleting the item -- DynamoDB TTL on `expiresAt` (execution plan Slice 1.4) reclaims
 * it in the background either way. */
const NOT_YET_CONSUMED_CONDITION = "(attribute_not_exists(consumed) OR consumed = :false)";

const isConditionalCheckFailure = (error: unknown): boolean =>
  error instanceof Error && error.name === "ConditionalCheckFailedException";

export const createDynamoDbSignInDispatchStore = ({
  documentClient,
  tableName,
}: {
  documentClient: DynamoDBDocumentClient;
  tableName: string;
}): SignInDispatchStore => ({
  async tryDispatch({ email, requestId, codeHash, now, codeTtlSeconds }) {
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const existing = await getRawCredential({ documentClient, tableName, email });

    if (existing?.requestId === requestId) {
      // A redelivery of the same message: resend the identical Code if it's still active,
      // but never resurrect one that already signed someone in.
      return { dispatched: !existing.consumed };
    }

    if (existing) {
      if (nowSeconds - existing.lastSentAt < RATE_LIMIT_COOLDOWN_SECONDS) {
        return { dispatched: false };
      }
      const withinWindow = existing.sendTimestamps.filter((sentAt) => nowSeconds - sentAt < RATE_LIMIT_WINDOW_SECONDS);
      if (withinWindow.length >= RATE_LIMIT_MAX_PER_HOUR) {
        return { dispatched: false };
      }

      const record: ActiveSignInCredential = {
        email,
        requestId,
        codeHash,
        createdAt: now.toISOString(),
        expiresAt: nowSeconds + codeTtlSeconds,
        wrongAttempts: 0,
        lastSentAt: nowSeconds,
        sendTimestamps: [...withinWindow, nowSeconds],
        consumed: false,
      };
      try {
        await documentClient.send(
          new PutCommand({
            TableName: tableName,
            Item: { ...credentialKey(email), ...record },
            ConditionExpression: "lastSentAt = :expectedLastSentAt",
            ExpressionAttributeValues: { ":expectedLastSentAt": existing.lastSentAt },
          }),
        );
        return { dispatched: true };
      } catch (error) {
        // Lost a race against a concurrent dispatch for the same Email; the safe default
        // under a security-relevant rate limit is to under-send, never to over-send.
        if (isConditionalCheckFailure(error)) return { dispatched: false };
        throw error;
      }
    }

    const record: ActiveSignInCredential = {
      email,
      requestId,
      codeHash,
      createdAt: now.toISOString(),
      expiresAt: nowSeconds + codeTtlSeconds,
      wrongAttempts: 0,
      lastSentAt: nowSeconds,
      sendTimestamps: [nowSeconds],
      consumed: false,
    };
    try {
      await documentClient.send(
        new PutCommand({
          TableName: tableName,
          Item: { ...credentialKey(email), ...record },
          ConditionExpression: "attribute_not_exists(pk)",
        }),
      );
      return { dispatched: true };
    } catch (error) {
      if (isConditionalCheckFailure(error)) return { dispatched: false };
      throw error;
    }
  },

  async getActiveCredential(email) {
    const existing = await getRawCredential({ documentClient, tableName, email });
    return existing && !existing.consumed ? existing : undefined;
  },

  async recordAttempt({ email, candidateHash, now }): Promise<AttemptOutcome> {
    const nowSeconds = Math.floor(now.getTime() / 1000);
    try {
      await documentClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: credentialKey(email),
          UpdateExpression: "SET consumed = :true",
          ConditionExpression: `codeHash = :candidateHash AND expiresAt > :now AND wrongAttempts < :max AND ${NOT_YET_CONSUMED_CONDITION}`,
          ExpressionAttributeValues: {
            ":candidateHash": candidateHash,
            ":now": nowSeconds,
            ":max": MAX_WRONG_ATTEMPTS,
            ":true": true,
            ":false": false,
          },
        }),
      );
      return "consumed";
    } catch (error) {
      if (!isConditionalCheckFailure(error)) throw error;
    }

    const current = await getRawCredential({ documentClient, tableName, email });
    if (!current || current.consumed) return "no_active_credential";
    if (current.expiresAt <= nowSeconds) return "expired";
    if (current.wrongAttempts >= MAX_WRONG_ATTEMPTS) return "exhausted";

    try {
      await documentClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: credentialKey(email),
          UpdateExpression: "SET wrongAttempts = wrongAttempts + :one",
          ConditionExpression: `attribute_exists(pk) AND expiresAt > :now AND wrongAttempts < :max AND ${NOT_YET_CONSUMED_CONDITION}`,
          ExpressionAttributeValues: { ":one": 1, ":now": nowSeconds, ":max": MAX_WRONG_ATTEMPTS, ":false": false },
        }),
      );
    } catch (error) {
      // A concurrent consume/expiry between the read above and this increment is an
      // astronomically rare race; under-counting the attempt here is the safe direction.
      if (!isConditionalCheckFailure(error)) throw error;
    }
    return "wrong";
  },
});

const getRawCredential = async ({
  documentClient,
  tableName,
  email,
}: {
  documentClient: DynamoDBDocumentClient;
  tableName: string;
  email: string;
}): Promise<ActiveSignInCredential | undefined> => {
  const result = await documentClient.send(
    new GetCommand({ TableName: tableName, Key: credentialKey(email), ConsistentRead: true }),
  );
  return asActiveSignInCredential(result.Item);
};

const asActiveSignInCredential = (item: Record<string, unknown> | undefined): ActiveSignInCredential | undefined => {
  if (
    !item ||
    typeof item.email !== "string" ||
    typeof item.requestId !== "string" ||
    typeof item.codeHash !== "string" ||
    typeof item.createdAt !== "string" ||
    typeof item.expiresAt !== "number" ||
    typeof item.wrongAttempts !== "number" ||
    typeof item.lastSentAt !== "number" ||
    !Array.isArray(item.sendTimestamps)
  ) {
    return undefined;
  }
  return { ...(item as unknown as ActiveSignInCredential), consumed: item.consumed === true };
};
