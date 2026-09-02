import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { AttemptOutcome, SignInChallenge, SignInChallengeStore } from "./sign-in-challenge.js";
import { MAX_WRONG_ATTEMPTS, RATE_LIMIT_COOLDOWN_SECONDS, RATE_LIMIT_MAX_PER_HOUR, RATE_LIMIT_WINDOW_SECONDS } from "./sign-in-challenge.js";

const challengeKey = (email: string) => ({ pk: `SIGN_IN#${email}`, sk: "CHALLENGE" });

/** `consumed` is a DynamoDB reserved word: every expression naming it directly is rejected
 * with a ValidationException, so they all go through this alias instead. */
const CONSUMED_NAMES = { "#consumed": "consumed" };

/** `codeHash`/`codeExpiresAt`/`wrongAttempts` all still need to be readable on a consumed
 * record (redelivery recognition, rate-limit history), so consuming sets this flag rather
 * than deleting the item -- DynamoDB TTL on `expiresAt` reclaims it in the background once
 * the rolling rate-limit window has also elapsed. */
const NOT_YET_CONSUMED_CONDITION = "(attribute_not_exists(#consumed) OR #consumed = :false)";

const isConditionalCheckFailure = (error: unknown): boolean =>
  error instanceof Error && error.name === "ConditionalCheckFailedException";

const ttlFor = (nowSeconds: number, codeTtlSeconds: number): number =>
  nowSeconds + Math.max(codeTtlSeconds, RATE_LIMIT_WINDOW_SECONDS);

export const createDynamoDbSignInChallengeStore = ({
  documentClient,
  tableName,
}: {
  documentClient: DynamoDBDocumentClient;
  tableName: string;
}): SignInChallengeStore => ({
  async tryDispatch({ email, requestId, codeHash, now, codeTtlSeconds }) {
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const existing = await getRawChallenge({ documentClient, tableName, email });

    if (existing?.requestId === requestId) {
      // A redelivery of the same message: resend the identical Code only while it's still
      // active, and never resurrect one that already signed someone in or has expired.
      return { dispatched: !existing.consumed && existing.codeExpiresAt > nowSeconds };
    }

    if (existing) {
      if (nowSeconds - existing.lastSentAt < RATE_LIMIT_COOLDOWN_SECONDS) {
        return { dispatched: false };
      }
      const withinWindow = existing.sendTimestamps.filter((sentAt) => nowSeconds - sentAt < RATE_LIMIT_WINDOW_SECONDS);
      if (withinWindow.length >= RATE_LIMIT_MAX_PER_HOUR) {
        return { dispatched: false };
      }

      const record: SignInChallenge = {
        email,
        requestId,
        codeHash,
        createdAt: now.toISOString(),
        codeExpiresAt: nowSeconds + codeTtlSeconds,
        expiresAt: ttlFor(nowSeconds, codeTtlSeconds),
        wrongAttempts: 0,
        lastSentAt: nowSeconds,
        sendTimestamps: [...withinWindow, nowSeconds],
        consumed: false,
      };
      try {
        await documentClient.send(
          new PutCommand({
            TableName: tableName,
            Item: { ...challengeKey(email), ...record },
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

    const record: SignInChallenge = {
      email,
      requestId,
      codeHash,
      createdAt: now.toISOString(),
      codeExpiresAt: nowSeconds + codeTtlSeconds,
      expiresAt: ttlFor(nowSeconds, codeTtlSeconds),
      wrongAttempts: 0,
      lastSentAt: nowSeconds,
      sendTimestamps: [nowSeconds],
      consumed: false,
    };
    try {
      await documentClient.send(
        new PutCommand({
          TableName: tableName,
          Item: { ...challengeKey(email), ...record },
          ConditionExpression: "attribute_not_exists(pk)",
        }),
      );
      return { dispatched: true };
    } catch (error) {
      if (isConditionalCheckFailure(error)) return { dispatched: false };
      throw error;
    }
  },

  async recordAttempt({ email, candidateHash, now }): Promise<AttemptOutcome> {
    const nowSeconds = Math.floor(now.getTime() / 1000);
    try {
      await documentClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: challengeKey(email),
          UpdateExpression: "SET #consumed = :true",
          ConditionExpression: `codeHash = :candidateHash AND codeExpiresAt > :now AND wrongAttempts < :max AND ${NOT_YET_CONSUMED_CONDITION}`,
          ExpressionAttributeNames: CONSUMED_NAMES,
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

    const current = await getRawChallenge({ documentClient, tableName, email });
    if (!current || current.consumed) return "no_active_challenge";
    if (current.codeExpiresAt <= nowSeconds) return "expired";
    if (current.wrongAttempts >= MAX_WRONG_ATTEMPTS) return "exhausted";

    try {
      await documentClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: challengeKey(email),
          UpdateExpression: "SET wrongAttempts = wrongAttempts + :one",
          ConditionExpression: `attribute_exists(pk) AND codeExpiresAt > :now AND wrongAttempts < :max AND ${NOT_YET_CONSUMED_CONDITION}`,
          ExpressionAttributeNames: CONSUMED_NAMES,
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

const getRawChallenge = async ({
  documentClient,
  tableName,
  email,
}: {
  documentClient: DynamoDBDocumentClient;
  tableName: string;
  email: string;
}): Promise<SignInChallenge | undefined> => {
  const result = await documentClient.send(
    new GetCommand({ TableName: tableName, Key: challengeKey(email), ConsistentRead: true }),
  );
  return asSignInChallenge(result.Item);
};

const asSignInChallenge = (item: Record<string, unknown> | undefined): SignInChallenge | undefined => {
  if (
    !item ||
    typeof item.email !== "string" ||
    typeof item.requestId !== "string" ||
    typeof item.codeHash !== "string" ||
    typeof item.createdAt !== "string" ||
    typeof item.codeExpiresAt !== "number" ||
    typeof item.expiresAt !== "number" ||
    typeof item.wrongAttempts !== "number" ||
    typeof item.lastSentAt !== "number" ||
    !Array.isArray(item.sendTimestamps)
  ) {
    return undefined;
  }
  return { ...(item as unknown as SignInChallenge), consumed: item.consumed === true };
};
