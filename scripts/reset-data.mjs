#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const USER_PARTITION_PREFIX = "USER#";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
loadDotEnv(join(rootDir, ".env"));

const options = parseOptions(process.argv.slice(2));
const region =
  options.region ??
  process.env.AWS_REGION ??
  process.env.AWS_DEFAULT_REGION ??
  "ap-southeast-2";
const stackName = options.stack ?? "PersonalAlbumStack";

if (options.help) {
  printHelp();
  process.exit(0);
}

if (!options.yes && !options.dryRun) {
  fail(
    [
      "This deletes development data from AWS resources.",
      "Re-run with --yes when you are ready, or use --dry-run to inspect first.",
    ].join("\n"),
  );
}

assertAwsCli();

try {
  const resources = discoverStackResources({
    stackName,
    region,
    profile: options.profile,
  });
  const buckets = resources
    .filter((resource) => resource.ResourceType === "AWS::S3::Bucket")
    .filter((resource) =>
      options.includeWebAssets
        ? true
        : !resource.LogicalResourceId.includes("WebAssets"),
    );
  const tables = resources.filter(
    (resource) => resource.ResourceType === "AWS::DynamoDB::Table",
  );
  const queues = resources.filter(
    (resource) => resource.ResourceType === "AWS::SQS::Queue",
  );
  const logGroups = options.includeLogs
    ? resources.filter(
        (resource) => resource.ResourceType === "AWS::Logs::LogGroup",
      )
    : [];

  console.log(`Resetting data in stack ${stackName} (${region})...`);

  for (const bucket of buckets) {
    emptyBucket(bucket.PhysicalResourceId, {
      region,
      profile: options.profile,
      dryRun: options.dryRun,
    });
  }

  for (const table of tables) {
    emptyTable(table.PhysicalResourceId, {
      region,
      profile: options.profile,
      dryRun: options.dryRun,
    });
  }

  for (const queue of queues) {
    purgeQueue(queue.PhysicalResourceId, {
      region,
      profile: options.profile,
      dryRun: options.dryRun,
    });
  }

  for (const logGroup of logGroups) {
    clearLogGroup(logGroup.PhysicalResourceId, {
      region,
      profile: options.profile,
      dryRun: options.dryRun,
    });
  }

  console.log(options.dryRun ? "Dry run complete." : "Data reset complete.");
} catch (error) {
  fail(error.message ?? String(error));
}

function loadDotEnv(envFile) {
  if (!existsSync(envFile)) {
    return;
  }

  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = rawValue
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2");
  }
}

function parseOptions(values) {
  const parsed = {};

  for (let index = 0; index < values.length; index += 1) {
    const arg = values[index];
    if (!arg.startsWith("--")) {
      fail(`Unexpected argument: ${arg}`);
    }

    const option = arg.slice(2);
    const equalsIndex = option.indexOf("=");
    const name = equalsIndex === -1 ? option : option.slice(0, equalsIndex);
    const inlineValue =
      equalsIndex === -1 ? undefined : option.slice(equalsIndex + 1);

    if (
      [
        "dry-run",
        "help",
        "include-logs",
        "include-web-assets",
        "yes",
      ].includes(name)
    ) {
      parsed[toCamelCase(name)] = true;
      continue;
    }

    const value = inlineValue ?? values[index + 1];
    if (value === undefined || value.startsWith("--")) {
      fail(`Missing value for --${name}.`);
    }

    parsed[toCamelCase(name)] = value;
    if (inlineValue === undefined) {
      index += 1;
    }
  }

  return parsed;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function assertAwsCli() {
  const result = spawnSync("aws", ["--version"], {
    encoding: "utf8",
  });

  if (result.error) {
    fail("Missing required command: aws. Install AWS CLI v2 and configure credentials.");
  }
}

function discoverStackResources({ stackName, region, profile }) {
  const response = awsJson(
    ["cloudformation", "list-stack-resources", "--stack-name", stackName],
    { profile, region },
  );

  return response.StackResourceSummaries ?? [];
}

function emptyBucket(bucketName, context) {
  console.log(`\nS3 ${bucketName}`);
  const versions = listObjectVersions(bucketName, context);
  console.log(`  object versions/delete markers: ${versions.length}`);

  if (!context.dryRun) {
    for (const batch of chunks(versions, 1000)) {
      deleteObjects(bucketName, batch, context);
    }
  }

  const uploads = listMultipartUploads(bucketName, context);
  console.log(`  incomplete multipart uploads: ${uploads.length}`);

  if (!context.dryRun) {
    for (const upload of uploads) {
      aws(
        [
          "s3api",
          "abort-multipart-upload",
          "--bucket",
          bucketName,
          "--key",
          upload.Key,
          "--upload-id",
          upload.UploadId,
        ],
        context,
      );
    }
  }
}

function listObjectVersions(bucketName, context) {
  const response = awsJson(
    ["s3api", "list-object-versions", "--bucket", bucketName],
    context,
  );

  return [
    ...(response.Versions ?? []),
    ...(response.DeleteMarkers ?? []),
  ].map((entry) => ({
    Key: entry.Key,
    VersionId: entry.VersionId,
  }));
}

function listMultipartUploads(bucketName, context) {
  const response = awsJson(
    ["s3api", "list-multipart-uploads", "--bucket", bucketName],
    context,
  );

  return response.Uploads ?? [];
}

function deleteObjects(bucketName, objects, context) {
  if (objects.length === 0) {
    return;
  }

  withJsonFile({ Objects: objects, Quiet: true }, (fileName) => {
    aws(
      [
        "s3api",
        "delete-objects",
        "--bucket",
        bucketName,
        "--delete",
        `file://${fileName}`,
      ],
      context,
    );
  });
}

function emptyTable(tableName, context) {
  console.log(`\nDynamoDB ${tableName}`);
  const { keyAttributes, partitionKeyAttribute } = getTableKeyAttributes(
    tableName,
    context,
  );
  let total = 0;
  let exclusiveStartKey;

  do {
    const scanArgs = [
      "dynamodb",
      "scan",
      "--table-name",
      tableName,
      "--projection-expression",
      keyAttributes.map((_, index) => `#k${index}`).join(", "),
      "--filter-expression",
      "begins_with(#pk, :userPrefix)",
      "--expression-attribute-names",
      JSON.stringify({
        ...Object.fromEntries(
          keyAttributes.map((attribute, index) => [`#k${index}`, attribute]),
        ),
        "#pk": partitionKeyAttribute,
      }),
      "--expression-attribute-values",
      JSON.stringify({ ":userPrefix": { S: USER_PARTITION_PREFIX } }),
    ];

    const response = exclusiveStartKey
      ? withJsonFile(exclusiveStartKey, (fileName) =>
          awsJson(
            [...scanArgs, "--exclusive-start-key", `file://${fileName}`],
            context,
          ),
        )
      : awsJson(scanArgs, context);
    const items = response.Items ?? [];
    total += items.length;

    if (!context.dryRun) {
      for (const batch of chunks(items, 25)) {
        batchDeleteItems(tableName, keyAttributes, batch, context);
      }
    }

    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);

  console.log(`  items under ${USER_PARTITION_PREFIX}*: ${total}`);
}

function getTableKeyAttributes(tableName, context) {
  const response = awsJson(
    ["dynamodb", "describe-table", "--table-name", tableName],
    context,
  );

  const keySchema = response.Table?.KeySchema ?? [];
  const keyAttributes = keySchema.map((entry) => entry.AttributeName);
  const partitionKeyAttribute = keySchema.find(
    (entry) => entry.KeyType === "HASH",
  )?.AttributeName;

  if (!keyAttributes.length || !partitionKeyAttribute) {
    fail(`Could not discover key schema for DynamoDB table ${tableName}.`);
  }

  return { keyAttributes, partitionKeyAttribute };
}

function batchDeleteItems(tableName, keyAttributes, items, context) {
  if (items.length === 0) {
    return;
  }

  let requestItems = {
    [tableName]: items.map((item) => ({
      DeleteRequest: {
        Key: Object.fromEntries(
          keyAttributes.map((attribute) => [attribute, item[attribute]]),
        ),
      },
    })),
  };

  while ((requestItems[tableName] ?? []).length > 0) {
    const response = withJsonFile(requestItems, (fileName) =>
      awsJson(
        ["dynamodb", "batch-write-item", "--request-items", `file://${fileName}`],
        context,
      ),
    );
    requestItems = response.UnprocessedItems ?? {};

    if ((requestItems[tableName] ?? []).length > 0) {
      sleep(500);
    }
  }
}

function purgeQueue(queueUrl, context) {
  console.log(`\nSQS ${queueUrl}`);
  if (context.dryRun) {
    console.log("  would purge");
    return;
  }

  try {
    aws(["sqs", "purge-queue", "--queue-url", queueUrl], context);
    console.log("  purged");
  } catch (error) {
    if (String(error.message).includes("PurgeQueueInProgress")) {
      console.log("  purge already in progress");
      return;
    }
    throw error;
  }
}

function clearLogGroup(logGroupName, context) {
  console.log(`\nCloudWatch Logs ${logGroupName}`);
  const response = awsJson(
    ["logs", "describe-log-streams", "--log-group-name", logGroupName],
    context,
  );
  const logStreams = response.logStreams ?? [];
  console.log(`  log streams: ${logStreams.length}`);

  if (context.dryRun) {
    return;
  }

  for (const stream of logStreams) {
    aws(
      [
        "logs",
        "delete-log-stream",
        "--log-group-name",
        logGroupName,
        "--log-stream-name",
        stream.logStreamName,
      ],
      context,
    );
  }
}

function awsJson(args, context) {
  const result = aws([...args, "--output", "json"], context);

  try {
    return JSON.parse(result.stdout || "{}");
  } catch {
    fail(`AWS CLI returned non-JSON output:\n${result.stdout || result.stderr}`);
  }
}

function aws(args, { profile, region }) {
  const finalArgs = [...args];
  if (region) {
    finalArgs.push("--region", region);
  }
  if (profile) {
    finalArgs.push("--profile", profile);
  }

  const result = spawnSync("aws", finalArgs, {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `aws ${finalArgs.join(" ")} failed.`);
  }

  return result;
}

function withJsonFile(value, callback) {
  const fileName = join(
    tmpdir(),
    `album-reset-data-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  writeFileSync(fileName, JSON.stringify(value));

  try {
    return callback(fileName);
  } finally {
    unlinkSync(fileName);
  }
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function printHelp() {
  console.log(`Usage:
  npm run reset:data -- --yes [options]
  npm run reset:data -- --dry-run [options]

Deletes user/development data from resources in the CloudFormation stack:
  - S3 bucket object versions and delete markers, excluding web assets by default
  - incomplete S3 multipart uploads
  - DynamoDB items under USER# partitions (photos, upload batches, timeline,
    processing issues, etc.); sign-in codes and maintenance records are kept
  - SQS queue messages

Options:
  --yes                  Required confirmation for deletion.
  --dry-run              Print discovered resources and counts without deleting.
  --include-web-assets   Also clear the deployed frontend asset bucket.
  --include-logs         Also delete CloudWatch log streams.
  --stack name           CloudFormation stack name. Default: PersonalAlbumStack.
  --region region        AWS region. Default: AWS_REGION, AWS_DEFAULT_REGION, ap-southeast-2.
  --profile profile      AWS profile.
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
