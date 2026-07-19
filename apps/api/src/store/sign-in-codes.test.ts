import { createInMemorySignInCodeStore } from "./in-memory-sign-in-code-store.js";
import { createDynamoDbSignInCodeStore } from "./dynamodb-sign-in-code-store.js";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

describe("InMemorySignInCodeStore", () => {
  it("round-trips records, deletes them, and isolates records by email and code ID", async () => {
    const store = createInMemorySignInCodeStore();
    const record = {
      email: "user@example.com",
      codeId: "code-1",
      userId: "user-1",
      codeHash: "hash",
      createdAt: "2026-07-19T00:00:00.000Z",
      expiresAt: 1_784_419_800,
    };
    await store.createSignInCode(record);

    await expect(
      store.getSignInCode({ email: "user@example.com", codeId: "code-1" }),
    ).resolves.toEqual(record);
    await expect(
      store.getSignInCode({ email: "other@example.com", codeId: "code-1" }),
    ).resolves.toBeUndefined();
    await expect(
      store.getSignInCode({ email: "user@example.com", codeId: "other-code" }),
    ).resolves.toBeUndefined();

    await store.deleteSignInCode({ email: "user@example.com", codeId: "code-1" });
    await expect(
      store.getSignInCode({ email: "user@example.com", codeId: "code-1" }),
    ).resolves.toBeUndefined();
  });
});

describe("DynamoDbSignInCodeStore", () => {
  it("uses SIGNIN and CODE keys with only the record fields", async () => {
    const commands: Array<{ input: Record<string, unknown> }> = [];
    const store = createDynamoDbSignInCodeStore({
      documentClient: {
        send: async (command: { input: Record<string, unknown> }) => {
          commands.push(command);
          return { Item: commands.length === 2 ? {
            email: "user@example.com", codeId: "code-1", userId: "user-1", codeHash: "hash",
            createdAt: "2026-07-19T00:00:00.000Z", expiresAt: 1_784_419_800,
          } : undefined };
        },
      } as unknown as DynamoDBDocumentClient,
      tableName: "metadata-table",
    });
    const record = {
      email: "user@example.com", codeId: "code-1", userId: "user-1", codeHash: "hash",
      createdAt: "2026-07-19T00:00:00.000Z", expiresAt: 1_784_419_800,
    };

    await store.createSignInCode(record);
    await expect(store.getSignInCode({ email: record.email, codeId: record.codeId })).resolves.toEqual(record);
    await store.deleteSignInCode({ email: record.email, codeId: record.codeId });

    expect(commands.map((command) => command.input)).toEqual([
      { TableName: "metadata-table", Item: { pk: "SIGNIN#user@example.com", sk: "CODE#code-1", ...record } },
      { TableName: "metadata-table", Key: { pk: "SIGNIN#user@example.com", sk: "CODE#code-1" } },
      { TableName: "metadata-table", Key: { pk: "SIGNIN#user@example.com", sk: "CODE#code-1" } },
    ]);
  });
});
