import type { SQSEvent, SQSHandler } from "aws-lambda";

export const handler: SQSHandler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    console.log(
      JSON.stringify({
        level: "info",
        message: "Photo processing scaffold received SQS record",
        messageId: record.messageId
      })
    );
  }
};

