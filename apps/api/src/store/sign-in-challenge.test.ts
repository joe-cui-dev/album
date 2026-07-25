import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createDynamoDbSignInChallengeStore } from "./dynamodb-sign-in-challenge-store.js";
import { createInMemorySignInChallengeStore } from "./in-memory-sign-in-challenge-store.js";
import type { SignInChallengeStore } from "./sign-in-challenge.js";

describe("InMemorySignInChallengeStore", () => {
  const dispatch = (store: SignInChallengeStore, overrides: Partial<Parameters<SignInChallengeStore["tryDispatch"]>[0]> = {}) =>
    store.tryDispatch({
      email: "user@example.com",
      requestId: "request-1",
      codeHash: "hash-1",
      now: new Date("2026-07-19T00:00:00.000Z"),
      codeTtlSeconds: 600,
      ...overrides,
    });

  it("dispatches a first request and installs an active Challenge verifiable by its hash", async () => {
    const store = createInMemorySignInChallengeStore();
    await expect(dispatch(store)).resolves.toEqual({ dispatched: true });
    await expect(
      store.recordAttempt({ email: "user@example.com", candidateHash: "hash-1", now: new Date("2026-07-19T00:00:01.000Z") }),
    ).resolves.toBe("consumed");
  });

  it("redelivers the same requestId without consuming a rate slot", async () => {
    const store = createInMemorySignInChallengeStore();
    await dispatch(store);
    // Immediately again (would violate the 60s cooldown if it were a new request).
    await expect(
      dispatch(store, { now: new Date("2026-07-19T00:00:05.000Z") }),
    ).resolves.toEqual({ dispatched: true });
    // Still the original Challenge (hash-1), not replaced by a new one.
    await expect(
      store.recordAttempt({ email: "user@example.com", candidateHash: "hash-1", now: new Date("2026-07-19T00:00:06.000Z") }),
    ).resolves.toBe("consumed");
  });

  it("never resends or re-arms a Code once its requestId's Challenge was already consumed", async () => {
    const store = createInMemorySignInChallengeStore();
    await dispatch(store);
    await store.recordAttempt({ email: "user@example.com", candidateHash: "hash-1", now: new Date("2026-07-19T00:00:10.000Z") });

    // A late redelivery of the exact same dispatch message, after the User already signed in with it.
    await expect(
      dispatch(store, { now: new Date("2026-07-19T00:00:20.000Z") }),
    ).resolves.toEqual({ dispatched: false });
    await expect(
      store.recordAttempt({ email: "user@example.com", candidateHash: "hash-1", now: new Date("2026-07-19T00:00:21.000Z") }),
    ).resolves.toBe("no_active_challenge");
  });

  it("never resends a redelivered message once its Code has expired, even though history is retained", async () => {
    const store = createInMemorySignInChallengeStore();
    await dispatch(store);
    // Past the 10-minute Code validity window, but still well inside the rolling hour used for rate history.
    await expect(
      dispatch(store, { now: new Date("2026-07-19T00:10:01.000Z") }),
    ).resolves.toEqual({ dispatched: false });
  });

  it("enforces the 60-second cooldown for a genuinely new request", async () => {
    const store = createInMemorySignInChallengeStore();
    await dispatch(store);
    await expect(
      dispatch(store, { requestId: "request-2", codeHash: "hash-2", now: new Date("2026-07-19T00:00:30.000Z") }),
    ).resolves.toEqual({ dispatched: false });
    // Still request-1's Challenge (hash-1), unaffected by the blocked attempt.
    await expect(
      store.recordAttempt({ email: "user@example.com", candidateHash: "hash-1", now: new Date("2026-07-19T00:00:31.000Z") }),
    ).resolves.toBe("consumed");
  });

  it("enforces the rolling 5-per-hour limit once the cooldown alone would allow a send", async () => {
    const store = createInMemorySignInChallengeStore();
    let minute = 0;
    for (let index = 0; index < 5; index += 1) {
      minute += 2;
      await expect(
        dispatch(store, { requestId: `request-${index}`, codeHash: `hash-${index}`, now: new Date(2026, 6, 19, 0, minute, 0) }),
      ).resolves.toEqual({ dispatched: true });
    }
    await expect(
      dispatch(store, { requestId: "request-6", codeHash: "hash-6", now: new Date(2026, 6, 19, 0, minute + 2, 0) }),
    ).resolves.toEqual({ dispatched: false });
  });

  it("still blocks a sixth send inside the rolling hour even after the fifth Code has expired", async () => {
    const store = createInMemorySignInChallengeStore();
    let minute = 0;
    for (let index = 0; index < 5; index += 1) {
      minute += 2;
      await dispatch(store, { requestId: `request-${index}`, codeHash: `hash-${index}`, now: new Date(2026, 6, 19, 0, minute, 0), codeTtlSeconds: 600 });
    }
    // The fifth send's 10-minute Code has expired, but its send history must still count
    // toward the rolling one-hour limit (retained via the longer DynamoDB TTL horizon).
    const wellPastCodeExpiry = new Date(2026, 6, 19, 0, minute + 15, 0);
    await expect(
      dispatch(store, { requestId: "request-6", codeHash: "hash-6", now: wellPastCodeExpiry }),
    ).resolves.toEqual({ dispatched: false });
  });

  it("allows a new send once the rolling window has moved on", async () => {
    const store = createInMemorySignInChallengeStore();
    for (let index = 0; index < 5; index += 1) {
      await dispatch(store, {
        requestId: `request-${index}`,
        codeHash: `hash-${index}`,
        now: new Date(new Date("2026-07-19T00:00:00.000Z").getTime() + index * 120_000),
      });
    }
    await expect(
      dispatch(store, { requestId: "request-6", codeHash: "hash-6", now: new Date("2026-07-19T01:10:00.000Z") }),
    ).resolves.toEqual({ dispatched: true });
  });

  describe("recordAttempt", () => {
    it("reports no_active_challenge when nothing was ever dispatched", async () => {
      const store = createInMemorySignInChallengeStore();
      await expect(
        store.recordAttempt({ email: "user@example.com", candidateHash: "hash-1", now: new Date() }),
      ).resolves.toBe("no_active_challenge");
    });

    it("consumes the Challenge on a matching hash so it can't be reused", async () => {
      const store = createInMemorySignInChallengeStore();
      await dispatch(store);
      await expect(
        store.recordAttempt({ email: "user@example.com", candidateHash: "hash-1", now: new Date("2026-07-19T00:01:00.000Z") }),
      ).resolves.toBe("consumed");
      await expect(
        store.recordAttempt({ email: "user@example.com", candidateHash: "hash-1", now: new Date("2026-07-19T00:01:01.000Z") }),
      ).resolves.toBe("no_active_challenge");
    });

    it("increments wrongAttempts on a mismatch up to the exhaustion limit", async () => {
      const store = createInMemorySignInChallengeStore();
      await dispatch(store);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await expect(
          store.recordAttempt({ email: "user@example.com", candidateHash: "wrong", now: new Date("2026-07-19T00:01:00.000Z") }),
        ).resolves.toBe("wrong");
      }
      await expect(
        store.recordAttempt({ email: "user@example.com", candidateHash: "hash-1", now: new Date("2026-07-19T00:01:00.000Z") }),
      ).resolves.toBe("exhausted");
    });

    it("reports expired once past the Code's verification deadline, even with the correct hash", async () => {
      const store = createInMemorySignInChallengeStore();
      await dispatch(store);
      await expect(
        store.recordAttempt({ email: "user@example.com", candidateHash: "hash-1", now: new Date("2026-07-19T00:10:01.000Z") }),
      ).resolves.toBe("expired");
    });
  });
});

describe("DynamoDbSignInChallengeStore", () => {
  const documentClientStub = (
    handlers: Partial<Record<"Get" | "Put" | "Update", (command: { input: Record<string, unknown> }) => unknown>>,
  ) => {
    const commands: Array<{ commandName: string; input: Record<string, unknown> }> = [];
    const send = async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const commandName = command.constructor.name.replace("Command", "");
      commands.push({ commandName, input: command.input });
      const handler = handlers[commandName as keyof typeof handlers];
      if (!handler) throw new Error(`Unhandled command ${commandName}`);
      return handler(command);
    };
    return { commands, documentClient: { send } as unknown as DynamoDBDocumentClient };
  };

  it("uses SIGN_IN/CHALLENGE keys, a not-exists condition, and the max(codeTtl, rate window) TTL for a first dispatch", async () => {
    const { commands, documentClient } = documentClientStub({
      Get: () => ({ Item: undefined }),
      Put: () => ({}),
    });
    const store = createDynamoDbSignInChallengeStore({ documentClient, tableName: "metadata-table" });

    await expect(
      store.tryDispatch({
        email: "user@example.com",
        requestId: "request-1",
        codeHash: "hash-1",
        now: new Date("2026-07-19T00:00:00.000Z"),
        codeTtlSeconds: 600,
      }),
    ).resolves.toEqual({ dispatched: true });

    expect(commands).toEqual([
      { commandName: "Get", input: { TableName: "metadata-table", Key: { pk: "SIGN_IN#user@example.com", sk: "CHALLENGE" }, ConsistentRead: true } },
      {
        commandName: "Put",
        input: {
          TableName: "metadata-table",
          Item: {
            pk: "SIGN_IN#user@example.com",
            sk: "CHALLENGE",
            email: "user@example.com",
            requestId: "request-1",
            codeHash: "hash-1",
            createdAt: "2026-07-19T00:00:00.000Z",
            codeExpiresAt: 1_784_419_800,
            expiresAt: 1_784_422_800,
            wrongAttempts: 0,
            lastSentAt: 1_784_419_200,
            sendTimestamps: [1_784_419_200],
            consumed: false,
          },
          ConditionExpression: "attribute_not_exists(pk)",
        },
      },
    ]);
  });

  it("under-sends (dispatched: false) when the Put loses a race", async () => {
    const conditionalFailure = Object.assign(new Error("failed"), { name: "ConditionalCheckFailedException" });
    const { documentClient } = documentClientStub({
      Get: () => ({ Item: undefined }),
      Put: () => {
        throw conditionalFailure;
      },
    });
    const store = createDynamoDbSignInChallengeStore({ documentClient, tableName: "metadata-table" });

    await expect(
      store.tryDispatch({
        email: "user@example.com",
        requestId: "request-1",
        codeHash: "hash-1",
        now: new Date("2026-07-19T00:00:00.000Z"),
        codeTtlSeconds: 600,
      }),
    ).resolves.toEqual({ dispatched: false });
  });

  it("never resends or re-arms a Code once the raw record shows its requestId already consumed", async () => {
    const { documentClient } = documentClientStub({
      Get: () => ({
        Item: {
          pk: "SIGN_IN#user@example.com",
          sk: "CHALLENGE",
          email: "user@example.com",
          requestId: "request-1",
          codeHash: "hash-1",
          createdAt: "2026-07-19T00:00:00.000Z",
          codeExpiresAt: 1_784_419_800,
          expiresAt: 1_784_422_800,
          wrongAttempts: 0,
          lastSentAt: 1_784_419_200,
          sendTimestamps: [1_784_419_200],
          consumed: true,
        },
      }),
    });
    const store = createDynamoDbSignInChallengeStore({ documentClient, tableName: "metadata-table" });

    await expect(
      store.tryDispatch({
        email: "user@example.com",
        requestId: "request-1",
        codeHash: "hash-1",
        now: new Date("2026-07-19T00:00:20.000Z"),
        codeTtlSeconds: 600,
      }),
    ).resolves.toEqual({ dispatched: false });
  });

  it("never resends a redelivered message once the raw record shows its Code has expired", async () => {
    const { documentClient } = documentClientStub({
      Get: () => ({
        Item: {
          pk: "SIGN_IN#user@example.com",
          sk: "CHALLENGE",
          email: "user@example.com",
          requestId: "request-1",
          codeHash: "hash-1",
          createdAt: "2026-07-19T00:00:00.000Z",
          codeExpiresAt: 1_784_419_800,
          expiresAt: 1_784_422_800,
          wrongAttempts: 0,
          lastSentAt: 1_784_419_200,
          sendTimestamps: [1_784_419_200],
          consumed: false,
        },
      }),
    });
    const store = createDynamoDbSignInChallengeStore({ documentClient, tableName: "metadata-table" });

    await expect(
      store.tryDispatch({
        email: "user@example.com",
        requestId: "request-1",
        codeHash: "hash-1",
        now: new Date("2026-07-19T00:10:01.000Z"),
        codeTtlSeconds: 600,
      }),
    ).resolves.toEqual({ dispatched: false });
  });

  it("atomically consumes via a conditional Update (SET consumed = true) on a matching hash, gated on codeExpiresAt", async () => {
    const { commands, documentClient } = documentClientStub({
      Update: () => ({}),
    });
    const store = createDynamoDbSignInChallengeStore({ documentClient, tableName: "metadata-table" });

    await expect(
      store.recordAttempt({ email: "user@example.com", candidateHash: "hash-1", now: new Date("2026-07-19T00:01:00.000Z") }),
    ).resolves.toBe("consumed");

    expect(commands).toEqual([
      {
        commandName: "Update",
        input: {
          TableName: "metadata-table",
          Key: { pk: "SIGN_IN#user@example.com", sk: "CHALLENGE" },
          UpdateExpression: "SET consumed = :true",
          ConditionExpression:
            "codeHash = :candidateHash AND codeExpiresAt > :now AND wrongAttempts < :max AND (attribute_not_exists(consumed) OR consumed = :false)",
          ExpressionAttributeValues: { ":candidateHash": "hash-1", ":now": 1_784_419_260, ":max": 5, ":true": true, ":false": false },
        },
      },
    ]);
  });

  it("falls back to a conditional Update (wrongAttempts + 1) when the consume condition fails on a mismatch", async () => {
    const conditionalFailure = Object.assign(new Error("failed"), { name: "ConditionalCheckFailedException" });
    let updateCalls = 0;
    const { commands, documentClient } = documentClientStub({
      Update: () => {
        updateCalls += 1;
        if (updateCalls === 1) throw conditionalFailure;
        return {};
      },
      Get: () => ({
        Item: {
          pk: "SIGN_IN#user@example.com",
          sk: "CHALLENGE",
          email: "user@example.com",
          requestId: "request-1",
          codeHash: "hash-1",
          createdAt: "2026-07-19T00:00:00.000Z",
          codeExpiresAt: 1_784_419_800,
          expiresAt: 1_784_422_800,
          wrongAttempts: 1,
          lastSentAt: 1_784_419_200,
          sendTimestamps: [1_784_419_200],
          consumed: false,
        },
      }),
    });
    const store = createDynamoDbSignInChallengeStore({ documentClient, tableName: "metadata-table" });

    await expect(
      store.recordAttempt({ email: "user@example.com", candidateHash: "wrong", now: new Date("2026-07-19T00:01:00.000Z") }),
    ).resolves.toBe("wrong");

    expect(commands.map((command) => command.commandName)).toEqual(["Update", "Get", "Update"]);
    expect(commands[2]).toMatchObject({
      commandName: "Update",
      input: {
        UpdateExpression: "SET wrongAttempts = wrongAttempts + :one",
        ConditionExpression: "attribute_exists(pk) AND codeExpiresAt > :now AND wrongAttempts < :max AND (attribute_not_exists(consumed) OR consumed = :false)",
      },
    });
  });
});
