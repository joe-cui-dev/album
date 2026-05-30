import { createSessionCookie } from "../auth.js";

describe("ListTimelinePhotos handler DynamoDB query", () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock("@aws-sdk/client-dynamodb");
    jest.dontMock("@aws-sdk/lib-dynamodb");
  });

  it("does not send unused ExpressionAttributeValues when querying a filtered timeline range", async () => {
    let queryInput: Record<string, unknown> | undefined;
    const send = jest.fn(async (command: { input: Record<string, unknown> }) => {
      if ("KeyConditionExpression" in command.input) {
        queryInput = command.input;
      }
      return { Items: [] };
    });

    jest.doMock("@aws-sdk/client-dynamodb", () => ({
      DynamoDBClient: jest.fn(),
    }));
    jest.doMock("@aws-sdk/lib-dynamodb", () => ({
      DynamoDBDocumentClient: {
        from: () => ({ send }),
      },
      GetCommand: jest.fn(function GetCommand(input) {
        this.input = input;
      }),
      QueryCommand: jest.fn(function QueryCommand(input) {
        this.input = input;
      }),
    }));

    const { handler } = await import("./list-timeline-photos.js");
    await handler(
      {
        cookies: [
          createSessionCookie({
            userId: "user-1",
            email: "user@example.com",
          }),
        ],
        headers: {},
        queryStringParameters: {
          year: "2025",
          month: "02",
        },
      } as never,
      {} as never,
      jest.fn(),
    );

    expect(queryInput).toMatchObject({
      KeyConditionExpression: "pk = :pk AND sk BETWEEN :fromSk AND :toSk",
      ExpressionAttributeValues: {
        ":pk": "USER#user-1",
        ":fromSk": "TIMELINE#2025-02-01T00:00:00.000Z",
        ":toSk": "TIMELINE#2025-03-01T00:00:00.000Z",
      },
    });
    expect(queryInput?.ExpressionAttributeValues).not.toHaveProperty(":timeline");
  });
});
