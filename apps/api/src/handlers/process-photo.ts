import type { SQSEvent, SQSHandler } from "aws-lambda";

export const handler: SQSHandler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    const objectKeys = extractS3ObjectKeys(record.body);
    console.log(
      JSON.stringify({
        level: "info",
        message: "Photo processing scaffold received SQS record",
        messageId: record.messageId,
        objects: objectKeys.map((objectKey) => ({
          objectKey,
          userId: extractUserIdFromObjectKey(objectKey),
        })),
      }),
    );
  }
};

const extractS3ObjectKeys = (body: string): string[] => {
  try {
    const parsed = JSON.parse(body) as {
      Records?: Array<{ s3?: { object?: { key?: string } } }>;
    };

    return (
      parsed.Records?.map((record) => record.s3?.object?.key)
        .filter((key): key is string => Boolean(key))
        .map((key) => decodeURIComponent(key.replace(/\+/g, " "))) ?? []
    );
  } catch {
    return [];
  }
};

const extractUserIdFromObjectKey = (objectKey: string): string | undefined => {
  const match = /^users\/([^/]+)\/originals\//.exec(objectKey);
  return match?.[1];
};
