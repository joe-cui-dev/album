import {
  DeleteCommand,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { SignInCodeRecord, SignInCodeStore } from "./sign-in-codes.js";

const codeKey = ({ email, codeId }: { email: string; codeId: string }) => ({
  pk: `SIGNIN#${email}`,
  sk: `CODE#${codeId}`,
});

export const createDynamoDbSignInCodeStore = ({
  documentClient,
  tableName,
}: {
  documentClient: DynamoDBDocumentClient;
  tableName: string;
}): SignInCodeStore => ({
  async createSignInCode(record) {
    await documentClient.send(
      new PutCommand({ TableName: tableName, Item: { ...codeKey(record), ...record } }),
    );
  },
  async getSignInCode(input) {
    const result = await documentClient.send(
      new GetCommand({ TableName: tableName, Key: codeKey(input) }),
    );
    return asSignInCodeRecord(result.Item);
  },
  async deleteSignInCode(input) {
    await documentClient.send(
      new DeleteCommand({ TableName: tableName, Key: codeKey(input) }),
    );
  },
});

const asSignInCodeRecord = (
  item: Record<string, unknown> | undefined,
): SignInCodeRecord | undefined => {
  if (
    !item ||
    typeof item.email !== "string" ||
    typeof item.codeId !== "string" ||
    typeof item.userId !== "string" ||
    typeof item.codeHash !== "string" ||
    typeof item.createdAt !== "string" ||
    typeof item.expiresAt !== "number"
  ) {
    return undefined;
  }
  return item as unknown as SignInCodeRecord;
};
