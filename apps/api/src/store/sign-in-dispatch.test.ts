import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createDynamoDbSignInDispatchStore } from "./dynamodb-sign-in-dispatch-store.js";
import { createInMemorySignInDispatchStore } from "./in-memory-sign-in-dispatch-store.js";
import type { SignInDispatchStore } from "./sign-in-dispatch.js";

describe("InMemorySignInDispatchStore", () => {
  const dispatch = (store: SignInDispatchStore, overrides: Partial<Parameters<SignInDispatchStore["tryDispatch"]>[0]> = {}) =>
    store.tryDispatch({
      email: "user@example.com",
      requestId: "request-1",
      codeHash: "hash-1",
      now: new Date("2026-07-19T00:00:00.000Z"),
      codeTtlSeconds: 600,
      ...overrides,
    });

  it("dispatches a first request and installs the active credential", async () => {
    const store = createInMemorySignInDispatchStore();
    await expect(dispatch(store)).resolves.toEqual({ dispatched: true });
    await expect(store.getActiveCredential("user@example.com")).resolves.toMatchObject({
      email: "user@example.com",
      requestId: "request-1",
      codeHash: "hash-1",
      expiresAt: 1_784_419_800,
      wrongAttempts: 0,
      consumed: false,
    });
  });

  it("redelivers the same requestId without consuming a rate slot", async () => {
    const store = createInMemorySignInDispatchStore();
    await dispatch(store);
    // Immediately again (would violate the 60s cooldown if it were a new request).
    await expect(
      dispatch(store, { now: new Date("2026-07-19T00:00:05.000Z") }),
    ).resolves.toEqual({ dispatched: true });
    await expect(store.getActiveCredential("user@example.com")).resolves.toMatchObject({ requestId: "request-1" });
  });

  it("never resends or re-arms a Code once its requestId's credential was already consumed", async () => {
    const store = createInMemorySignInDispatchStore();
    await dispatch(store);
    await store.recordAttempt({ email: "user@example.com", candidateHash: "hash-1", now: new Date("2026-07-19T00:00:10.000Z") });

    // A late redelivery of the exact same dispatch message, after the User already signed in with it.
    await expect(
      dispatch(store, { now: new Date("2026-07-19T00:00:20.000Z") }),
    ).resolves.toEqual({ dispatched: false });
    await expect(store.getActiveCredential("user@example.com")).resolves.toBeUndefined();
    await expect(
      store.recordAttempt({ email: "user@example.com", candidateHash: "hash-1", now: new Date("2026-07-19T00:00:21.000Z") }),
    ).resolves.toBe("no_active_credential");
  });

  it("enforces the 60-second cooldown for a genuinely new request", async () => {
    const store = createInMemorySignInDispatchStore();
    await dispatch(store);
    await expect(
      dispatch(store, { requestId: "request-2", codeHash: "hash-2", now: new Date("2026-07-19T00:00:30.000Z") }),
    ).resolves.toEqual({ dispatched: false });
    await expect(store.getActiveCredential("user@example.com")).resolves.toMatchObject({ requestId: "request-1" });
  });

  it("enforces the rolling 5-per-hour limit once the cooldown alone would allow a send", async () => {
    const store = createInMemorySignInDispatchStore();
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

  it("allows a new send once the rolling window has moved on", async () => {
    const store = createInMemorySignInDispatchStore();
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
    it("reports no_active_credential when nothing was ever dispatched", async () => {
      const store = createInMemorySignInDispatchStore();
      await expect(
        store.recordAttempt({ email: "user@example.com", candidateHash: "hash-1", now: new Date() }),
      ).resolves.toBe("no_active_credential");
    });

    it("consumes the credential on a matching hash so it can't be reused", async () => {
      const store = createInMemorySignInDispatchStore();
      await dispatch(store);
      await expect(
        store.recordAttempt({ email: "user@example.com", candidateHash: "hash-1", now: new Date("2026-07-19T00:01:00.000Z") }),
      ).resolves.toBe("consumed");
      await expect(store.getActiveCredential("user@example.com")).resolves.toBeUndefined();
      await expect(
        store.recordAttempt({ email: "user@example.com", candidateHash: "hash-1", now: new Date("2026-07-19T00:01:01.000Z") }),
      ).resolves.toBe("no_active_credential");
    });

    it("increments wrongAttempts on a mismatch up to the exhaustion limit", async () => {
      const store = createInMemorySignInDispatchStore();
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

    it("reports expired once past the credential's expiry, even with the correct hash", async () => {
      const store = createInMemorySignInDispatchStore();
      await dispatch(store);
      await expect(
        store.recordAttempt({ email: "user@example.com", candidateHash: "hash-1", now: new Date("2026-07-19T00:10:01.000Z") }),
      ).resolves.toBe("expired");
    });
  });
});

describe("DynamoDbSignInDispatchStore", () => {
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

  it("uses SIGNIN2/CREDENTIAL keys and a not-exists condition for a first dispatch", async () => {
    const { commands, documentClient } = documentClientStub({
      Get: () => ({ Item: undefined }),
      Put: () => ({}),
    });
    const store = createDynamoDbSignInDispatchStore({ documentClient, tableName: "metadata-table" });

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
      { commandName: "Get", input: { TableName: "metadata-table", Key: { pk: "SIGNIN2#user@example.com", sk: "CREDENTIAL" }, ConsistentRead: true } },
      {
        commandName: "Put",
        input: {
          TableName: "metadata-table",
          Item: {
            pk: "SIGNIN2#user@example.com",
            sk: "CREDENTIAL",
            email: "user@example.com",
            requestId: "request-1",
            codeHash: "hash-1",
            createdAt: "2026-07-19T00:00:00.000Z",
            expiresAt: 1_784_419_800,
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
    const store = createDynamoDbSignInDispatchStore({ documentClient, tableName: "metadata-table" });

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
          pk: "SIGNIN2#user@example.com",
          sk: "CREDENTIAL",
          email: "user@example.com",
          requestId: "request-1",
          codeHash: "hash-1",
          createdAt: "2026-07-19T00:00:00.000Z",
          expiresAt: 1_784_419_800,
          wrongAttempts: 0,
          lastSentAt: 1_784_419_200,
          sendTimestamps: [1_784_419_200],
          consumed: true,
        },
      }),
    });
    const store = createDynamoDbSignInDispatchStore({ documentClient, tableName: "metadata-table" });

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

  it("atomically consumes via a conditional Update (SET consumed = true) on a matching hash", async () => {
    const { commands, documentClient } = documentClientStub({
      Update: () => ({}),
    });
    const store = createDynamoDbSignInDispatchStore({ documentClient, tableName: "metadata-table" });

    await expect(
      store.recordAttempt({ email: "user@example.com", candidateHash: "hash-1", now: new Date("2026-07-19T00:01:00.000Z") }),
    ).resolves.toBe("consumed");

    expect(commands).toEqual([
      {
        commandName: "Update",
        input: {
          TableName: "metadata-table",
          Key: { pk: "SIGNIN2#user@example.com", sk: "CREDENTIAL" },
          UpdateExpression: "SET consumed = :true",
          ConditionExpression:
            "codeHash = :candidateHash AND expiresAt > :now AND wrongAttempts < :max AND (attribute_not_exists(consumed) OR consumed = :false)",
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
          pk: "SIGNIN2#user@example.com",
          sk: "CREDENTIAL",
          email: "user@example.com",
          requestId: "request-1",
          codeHash: "hash-1",
          createdAt: "2026-07-19T00:00:00.000Z",
          expiresAt: 1_784_419_800,
          wrongAttempts: 1,
          lastSentAt: 1_784_419_200,
          sendTimestamps: [1_784_419_200],
          consumed: false,
        },
      }),
    });
    const store = createDynamoDbSignInDispatchStore({ documentClient, tableName: "metadata-table" });

    await expect(
      store.recordAttempt({ email: "user@example.com", candidateHash: "wrong", now: new Date("2026-07-19T00:01:00.000Z") }),
    ).resolves.toBe("wrong");

    expect(commands.map((command) => command.commandName)).toEqual(["Update", "Get", "Update"]);
    expect(commands[2]).toMatchObject({
      commandName: "Update",
      input: {
        UpdateExpression: "SET wrongAttempts = wrongAttempts + :one",
        ConditionExpression: "attribute_exists(pk) AND expiresAt > :now AND wrongAttempts < :max AND (attribute_not_exists(consumed) OR consumed = :false)",
      },
    });
  });
});
