import { GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { CapturedAt } from "@album/shared";
import { ConcurrentPhotoModificationError } from "./errors.js";
import { createDynamoDbPersonalAlbumStore } from "./dynamodb-store.js";
import { timelinePeriodUpperBoundSortKey } from "./v2-keys.js";

const june15: CapturedAt = { precision: "day", localDate: "2024-06-15" };
const thumbnails = {
  small: { objectKey: "timeline-thumbnails/user-1/photo-1.jpg", dimensions: { width: 320, height: 160 } },
  large: { objectKey: "timeline-thumbnails/user-1/photo-1-large.jpg", dimensions: { width: 640, height: 320 } },
};

const fakeClient = (
  photoItem: Record<string, unknown> | undefined,
  issueItem: Record<string, unknown> | undefined = undefined,
) => {
  const commands: unknown[] = [];
  const documentClient = {
    send: async (command: unknown) => {
      commands.push(command);
      if (command instanceof GetCommand) {
        const sk = String((command.input.Key as { sk?: string } | undefined)?.sk ?? "");
        if (sk.startsWith("PHOTO#")) {
          return { Item: photoItem };
        }
        if (sk.startsWith("PROCESSING_ISSUE#")) {
          return { Item: issueItem };
        }
        return { Item: undefined };
      }
      return {};
    },
  } as unknown as DynamoDBDocumentClient;
  return { documentClient, commands };
};

const queryClient = (items: Array<Record<string, unknown>>) => {
  const commands: unknown[] = [];
  const documentClient = {
    send: async (command: unknown) => {
      commands.push(command);
      if (command instanceof QueryCommand) {
        return { Items: items };
      }
      return {};
    },
  } as unknown as DynamoDBDocumentClient;
  return { documentClient, commands };
};

const fakeClientThatCancelsTransactions = (photoItem: Record<string, unknown>) => {
  const documentClient = {
    send: async (command: unknown) => {
      if (command instanceof GetCommand) {
        return { Item: photoItem };
      }
      if (command instanceof TransactWriteCommand) {
        const error = new Error("Transaction cancelled");
        error.name = "TransactionCanceledException";
        throw error;
      }
      return {};
    },
  } as unknown as DynamoDBDocumentClient;
  return { documentClient };
};

describe("DynamoDbPersonalAlbumStore v2 commands: publishReadyPhotoV2", () => {
  it("reads Added At then transact-writes the Photo update, Active projection, and Date Index", async () => {
    const { documentClient, commands } = fakeClient({ uploadRequestedAt: "2026-07-19T00:00:00.000Z" });
    const album = createDynamoDbPersonalAlbumStore({ documentClient, tableName: "metadata-table" }).personalAlbumOf(
      "user-1",
    );

    await album.publishReadyPhotoV2({
      photoId: "photo-1",
      fileName: "photo-1.jpg",
      sha256: "hash",
      displayObjectKey: "display/user-1/photo-1.jpg",
      displayDimensions: { width: 100, height: 50 },
      timelineThumbnails: thumbnails,
      metadata: {},
      originalCapturedAt: june15,
      originalCapturedAtSource: "exif",
      hadOpenProcessingIssue: false,
    });

    const transact = commands.find((command) => command instanceof TransactWriteCommand) as TransactWriteCommand;
    const items = transact.input.TransactItems ?? [];
    expect(items[0]?.Update).toEqual(
      expect.objectContaining({
        Key: { pk: "USER#user-1", sk: "PHOTO#photo-1" },
      }),
    );
    expect(items[0]?.Update?.ConditionExpression).toBeUndefined();
    expect(items[0]?.Update?.UpdateExpression).toContain("chronology = :chronology");
    expect(items[1]?.Put?.Item).toEqual(
      expect.objectContaining({
        pk: "USER#user-1",
        sk: "TIMELINE_V2#ACTIVE#2024.06.15.--.--.--.------#2026-07-19T00:00:00.000Z#photo-1",
        collection: "active",
      }),
    );
    expect(items[2]?.Update).toEqual(
      expect.objectContaining({
        Key: { pk: "USER#user-1", sk: "DATE_INDEX_V2#ACTIVE#2024" },
        UpdateExpression: "ADD #period :delta",
        ExpressionAttributeNames: { "#period": "06" },
      }),
    );
    expect(items).toHaveLength(3);
  });

  it("includes an attemptId condition and Issue resolution when provided", async () => {
    const { documentClient, commands } = fakeClient({ uploadRequestedAt: "2026-07-19T00:00:00.000Z" });
    const album = createDynamoDbPersonalAlbumStore({ documentClient, tableName: "metadata-table" }).personalAlbumOf(
      "user-1",
    );

    await album.publishReadyPhotoV2({
      photoId: "photo-1",
      fileName: "photo-1.jpg",
      sha256: "hash",
      displayObjectKey: "display/user-1/photo-1.jpg",
      displayDimensions: { width: 100, height: 50 },
      timelineThumbnails: thumbnails,
      metadata: {},
      originalCapturedAt: june15,
      originalCapturedAtSource: "exif",
      attemptId: "attempt-A",
      hadOpenProcessingIssue: true,
    });

    const transact = commands.find((command) => command instanceof TransactWriteCommand) as TransactWriteCommand;
    const items = transact.input.TransactItems ?? [];
    expect(items[0]?.Update?.ConditionExpression).toBe("processingAttemptId = :attemptId");
    expect(items).toHaveLength(5);
    expect(items[3]?.Delete).toEqual(
      expect.objectContaining({
        Key: { pk: "USER#user-1", sk: "PROCESSING_ISSUE#2026-07-19T00:00:00.000Z#photo-1" },
      }),
    );
    expect(items[4]?.Update).toEqual(
      expect.objectContaining({
        Key: { pk: "USER#user-1", sk: "PROCESSING_ISSUES#SUMMARY" },
        UpdateExpression: "ADD openCount :delta",
        ConditionExpression: "openCount >= :absDelta",
      }),
    );
  });
});

describe("DynamoDbPersonalAlbumStore v2 commands: setArchiveMembershipV2", () => {
  it("moves the projection and transfers the Date Index count", async () => {
    const { documentClient, commands } = fakeClient({
      processingState: "ready",
      archived: false,
      uploadRequestedAt: "2026-07-19T00:00:00.000Z",
      fileName: "photo-1.jpg",
      displayDimensions: { width: 100, height: 50 },
      timelineThumbnails: thumbnails,
      chronology: {
        original: { capturedAt: june15, source: "exif" },
        active: { capturedAt: june15, source: "exif", revision: 0 },
      },
    });
    const album = createDynamoDbPersonalAlbumStore({ documentClient, tableName: "metadata-table" }).personalAlbumOf(
      "user-1",
    );

    await album.setArchiveMembershipV2({ photoId: "photo-1", archived: true });

    const transact = commands.find((command) => command instanceof TransactWriteCommand) as TransactWriteCommand;
    const items = transact.input.TransactItems ?? [];
    expect(items[0]?.Update).toEqual(
      expect.objectContaining({
        UpdateExpression: "SET archived = :archived",
        ConditionExpression: "archived = :currentArchived AND chronology.active.revision = :currentRevision",
        ExpressionAttributeValues: { ":archived": true, ":currentArchived": false, ":currentRevision": 0 },
      }),
    );
    expect(items[1]?.Delete?.Key?.sk).toContain("TIMELINE_V2#ACTIVE#");
    expect(items[2]?.Put?.Item?.sk).toContain("TIMELINE_V2#ARCHIVED#");
    expect(items[3]?.Update?.Key).toEqual({ pk: "USER#user-1", sk: "DATE_INDEX_V2#ACTIVE#2024" });
    expect(items[3]?.Update?.ExpressionAttributeValues?.[":delta"]).toBe(-1);
    expect(items[4]?.Update?.Key).toEqual({ pk: "USER#user-1", sk: "DATE_INDEX_V2#ARCHIVED#2024" });
    expect(items[4]?.Update?.ExpressionAttributeValues?.[":delta"]).toBe(1);
  });

  it("throws ConcurrentPhotoModificationError when a concurrent write cancels the transaction", async () => {
    const { documentClient } = fakeClientThatCancelsTransactions({
      processingState: "ready",
      archived: false,
      uploadRequestedAt: "2026-07-19T00:00:00.000Z",
      fileName: "photo-1.jpg",
      displayDimensions: { width: 100, height: 50 },
      timelineThumbnails: thumbnails,
      chronology: {
        original: { capturedAt: june15, source: "exif" },
        active: { capturedAt: june15, source: "exif", revision: 0 },
      },
    });
    const album = createDynamoDbPersonalAlbumStore({ documentClient, tableName: "metadata-table" }).personalAlbumOf(
      "user-1",
    );

    await expect(
      album.setArchiveMembershipV2({ photoId: "photo-1", archived: true }),
    ).rejects.toBeInstanceOf(ConcurrentPhotoModificationError);
  });
});

describe("DynamoDbPersonalAlbumStore v2 commands: replaceActiveChronologyV2", () => {
  it("conditions the update on the expected revision", async () => {
    const { documentClient, commands } = fakeClient({
      processingState: "ready",
      archived: false,
      uploadRequestedAt: "2026-07-19T00:00:00.000Z",
      fileName: "photo-1.jpg",
      displayDimensions: { width: 100, height: 50 },
      timelineThumbnails: thumbnails,
      chronology: {
        original: { capturedAt: june15, source: "exif" },
        active: { capturedAt: june15, source: "exif", revision: 0 },
      },
    });
    const album = createDynamoDbPersonalAlbumStore({ documentClient, tableName: "metadata-table" }).personalAlbumOf(
      "user-1",
    );

    const result = await album.replaceActiveChronologyV2({
      photoId: "photo-1",
      capturedAt: { precision: "year", localDate: "2023" },
      expectedRevision: 0,
    });

    expect(result).toEqual({ revision: 1 });
    const transact = commands.find((command) => command instanceof TransactWriteCommand) as TransactWriteCommand;
    const items = transact.input.TransactItems ?? [];
    expect(items[0]?.Update).toEqual(
      expect.objectContaining({
        UpdateExpression: "SET chronology.active = :active",
        ConditionExpression: "chronology.active.revision = :expectedRevision AND archived = :currentArchived",
      }),
    );
    expect(items[0]?.Update?.ExpressionAttributeValues?.[":active"]).toEqual({
      capturedAt: { precision: "year", localDate: "2023" },
      source: "userAdjusted",
      revision: 1,
    });
  });
});

describe("DynamoDbPersonalAlbumStore v2 commands: claimProcessingAttempt", () => {
  it("attempts a fresh conditional claim first", async () => {
    const { documentClient, commands } = fakeClient(undefined);
    const album = createDynamoDbPersonalAlbumStore({ documentClient, tableName: "metadata-table" }).personalAlbumOf(
      "user-1",
    );

    await expect(
      album.claimProcessingAttempt({ photoId: "photo-1", attemptId: "attempt-A", startedAt: "t1" }),
    ).resolves.toBe("claimed");

    const update = commands.find((command) => command instanceof UpdateCommand) as UpdateCommand;
    expect(update.input).toEqual(
      expect.objectContaining({
        ConditionExpression: "attribute_not_exists(processingAttemptId)",
      }),
    );
  });
});

describe("DynamoDbPersonalAlbumStore v2 commands: recordProcessingIssueV2", () => {
  it("creates a new Issue and increments the open count when none exists", async () => {
    const { documentClient, commands } = fakeClient({ uploadRequestedAt: "2026-07-19T00:00:00.000Z" });
    const album = createDynamoDbPersonalAlbumStore({ documentClient, tableName: "metadata-table" }).personalAlbumOf(
      "user-1",
    );

    await album.recordProcessingIssueV2({
      photoId: "photo-1",
      fileName: "photo-1.jpg",
      reasonCode: "unsupportedImage",
      attemptedAt: "2026-07-19T00:01:00.000Z",
    });

    const transact = commands.find((command) => command instanceof TransactWriteCommand) as TransactWriteCommand;
    const items = transact.input.TransactItems ?? [];
    expect(items[1]?.Put?.Item).toEqual(
      expect.objectContaining({
        sk: "PROCESSING_ISSUE#2026-07-19T00:00:00.000Z#photo-1",
        status: "failed",
        attemptCount: 1,
      }),
    );
    expect(items[2]?.Update?.Key).toEqual({ pk: "USER#user-1", sk: "PROCESSING_ISSUES#SUMMARY" });
  });
});

describe("DynamoDbPersonalAlbumStore v2 commands: queryTimelinePageV2", () => {
  it("uses a strongly consistent, descending, begins_with query with no bound on the first page", async () => {
    const { documentClient, commands } = queryClient([]);
    const album = createDynamoDbPersonalAlbumStore({ documentClient, tableName: "metadata-table" }).personalAlbumOf(
      "user-1",
    );

    await album.queryTimelinePageV2({ collection: "active", limit: 80 });

    const query = commands.find((command) => command instanceof QueryCommand) as QueryCommand;
    expect(query.input).toEqual(
      expect.objectContaining({
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": "USER#user-1", ":prefix": "TIMELINE_V2#ACTIVE#" },
        ScanIndexForward: false,
        Limit: 80,
        ConsistentRead: true,
      }),
    );
    expect(query.input.ExclusiveStartKey).toBeUndefined();
  });

  it("resumes strictly after the cursor's last sort key", async () => {
    const { documentClient, commands } = queryClient([]);
    const album = createDynamoDbPersonalAlbumStore({ documentClient, tableName: "metadata-table" }).personalAlbumOf(
      "user-1",
    );

    await album.queryTimelinePageV2({
      collection: "active",
      limit: 80,
      after: { sortKey: "TIMELINE_V2#ACTIVE#2024.06.15.--.--.--.------#2026-01-01T00:00:00.000Z#photo-1" },
    });

    const query = commands.find((command) => command instanceof QueryCommand) as QueryCommand;
    expect(query.input.ExclusiveStartKey).toEqual({
      pk: "USER#user-1",
      sk: "TIMELINE_V2#ACTIVE#2024.06.15.--.--.--.------#2026-01-01T00:00:00.000Z#photo-1",
    });
  });

  it("anchors a startAt period with an inclusive BETWEEN bound", async () => {
    const { documentClient, commands } = queryClient([]);
    const album = createDynamoDbPersonalAlbumStore({ documentClient, tableName: "metadata-table" }).personalAlbumOf(
      "user-1",
    );

    await album.queryTimelinePageV2({
      collection: "active",
      limit: 80,
      atOrBefore: { sortKey: timelinePeriodUpperBoundSortKey("active", { year: 2024, month: 6 }) },
    });

    const query = commands.find((command) => command instanceof QueryCommand) as QueryCommand;
    expect(query.input).toEqual(
      expect.objectContaining({
        KeyConditionExpression: "pk = :pk AND sk BETWEEN :lower AND :upper",
        ExpressionAttributeValues: {
          ":pk": "USER#user-1",
          ":lower": "TIMELINE_V2#ACTIVE#",
          ":upper": timelinePeriodUpperBoundSortKey("active", { year: 2024, month: 6 }),
        },
      }),
    );
  });

  it("returns lastSortKey only when the page is exactly full", async () => {
    const full = queryClient([
      { photoId: "a", sk: "TIMELINE_V2#ACTIVE#a" },
      { photoId: "b", sk: "TIMELINE_V2#ACTIVE#b" },
    ]);
    const album = createDynamoDbPersonalAlbumStore({
      documentClient: full.documentClient,
      tableName: "metadata-table",
    }).personalAlbumOf("user-1");
    await expect(album.queryTimelinePageV2({ collection: "active", limit: 2 })).resolves.toMatchObject({
      lastSortKey: "TIMELINE_V2#ACTIVE#b",
    });

    const partial = queryClient([{ photoId: "a", sk: "TIMELINE_V2#ACTIVE#a" }]);
    const albumPartial = createDynamoDbPersonalAlbumStore({
      documentClient: partial.documentClient,
      tableName: "metadata-table",
    }).personalAlbumOf("user-1");
    await expect(
      albumPartial.queryTimelinePageV2({ collection: "active", limit: 2 }),
    ).resolves.toEqual({ projections: expect.any(Array) });
  });
});

describe("DynamoDbPersonalAlbumStore v2 commands: listDateIndexYearsV2", () => {
  it("queries by the collection's Date Index prefix and strips pk/sk from the counts", async () => {
    const { documentClient, commands } = queryClient([
      { pk: "USER#user-1", sk: "DATE_INDEX_V2#ACTIVE#2024", "06": 2 },
      { pk: "USER#user-1", sk: "DATE_INDEX_V2#ACTIVE#2020", unknown: 1 },
    ]);
    const album = createDynamoDbPersonalAlbumStore({ documentClient, tableName: "metadata-table" }).personalAlbumOf(
      "user-1",
    );

    const years = await album.listDateIndexYearsV2("active");

    const query = commands.find((command) => command instanceof QueryCommand) as QueryCommand;
    expect(query.input.ExpressionAttributeValues).toEqual({
      ":pk": "USER#user-1",
      ":prefix": "DATE_INDEX_V2#ACTIVE#",
    });
    expect(years).toEqual([
      { year: 2024, counts: { "06": 2 } },
      { year: 2020, counts: { unknown: 1 } },
    ]);
  });

  it("omits a zero-valued month left over from a conditioned ADD that reached zero", async () => {
    const { documentClient } = queryClient([
      { pk: "USER#user-1", sk: "DATE_INDEX_V2#ACTIVE#2024", "06": 1, "07": 0 },
      { pk: "USER#user-1", sk: "DATE_INDEX_V2#ACTIVE#2020", "01": 0 },
    ]);
    const album = createDynamoDbPersonalAlbumStore({ documentClient, tableName: "metadata-table" }).personalAlbumOf(
      "user-1",
    );

    const years = await album.listDateIndexYearsV2("active");

    expect(years).toEqual([{ year: 2024, counts: { "06": 1 } }]);
  });
});

describe("DynamoDbPersonalAlbumStore v2 commands: getDateIndexV2", () => {
  it("omits zero-valued periods from a year that still has other nonzero periods", async () => {
    const documentClient = {
      send: async () => ({ Item: { pk: "USER#user-1", sk: "DATE_INDEX_V2#ACTIVE#2024", "06": 1, "07": 0 } }),
    } as unknown as DynamoDBDocumentClient;
    const album = createDynamoDbPersonalAlbumStore({ documentClient, tableName: "metadata-table" }).personalAlbumOf(
      "user-1",
    );

    await expect(album.getDateIndexV2("active", 2024)).resolves.toEqual({ "06": 1 });
  });
});

describe("DynamoDbPersonalAlbumStore v2 commands: getProcessingIssuesSummary", () => {
  it("reads the singleton summary item's openCount", async () => {
    const documentClient = {
      send: async () => ({ Item: { openCount: 3 } }),
    } as unknown as DynamoDBDocumentClient;
    const album = createDynamoDbPersonalAlbumStore({ documentClient, tableName: "metadata-table" }).personalAlbumOf(
      "user-1",
    );
    await expect(album.getProcessingIssuesSummary()).resolves.toBe(3);
  });

  it("defaults to 0 when the summary item does not exist yet", async () => {
    const documentClient = { send: async () => ({}) } as unknown as DynamoDBDocumentClient;
    const album = createDynamoDbPersonalAlbumStore({ documentClient, tableName: "metadata-table" }).personalAlbumOf(
      "user-1",
    );
    await expect(album.getProcessingIssuesSummary()).resolves.toBe(0);
  });
});
