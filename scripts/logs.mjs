#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const envFile = join(rootDir, ".env");

if (existsSync(envFile)) {
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

const args = process.argv.slice(2);
const command = args[0]?.startsWith("-") ? "query" : (args.shift() ?? "query");
const options = parseOptions(args);
const region =
  options.region ??
  process.env.AWS_REGION ??
  process.env.AWS_DEFAULT_REGION ??
  "ap-southeast-2";
const stackName = options.stack ?? "PersonalAlbumStack";
const limit = Number(options.limit ?? "50");

if (options.help || command === "help") {
  printHelp();
  process.exit(0);
}

if (!Number.isInteger(limit) || limit < 1) {
  fail("--limit must be a positive integer.");
}

assertAwsCli();

const logGroups = discoverLogGroups({
  stackName,
  region,
  profile: options.profile,
});
if (logGroups.length === 0) {
  fail(`No CloudWatch log groups found in stack ${stackName}.`);
}

if (command === "tail") {
  runLiveTail({
    logGroups,
    region,
    profile: options.profile,
    filter: options.filter ?? options.contains,
  });
} else if (command === "query") {
  runInsightsQuery({
    logGroups,
    region,
    profile: options.profile,
    queryString: options.query ?? buildDefaultQuery(options, limit),
    since: options.since ?? "30m",
    limit,
  });
} else if (command === "groups") {
  for (const group of logGroups) {
    console.log(group);
  }
} else {
  fail(`Unknown command: ${command}`);
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
    if (name === "help") {
      parsed.help = true;
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

function awsJson(args, { profile, region }) {
  const result = aws([...args, "--output", "json"], { profile, region });

  try {
    return JSON.parse(result.stdout);
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
    fail(result.error.message);
  }

  if (result.status !== 0) {
    fail(result.stderr.trim() || `aws ${finalArgs.join(" ")} failed.`);
  }

  return result;
}

function discoverLogGroups({ stackName, region, profile }) {
  const response = awsJson(
    [
      "cloudformation",
      "describe-stack-resources",
      "--stack-name",
      stackName,
      "--query",
      "StackResources[?ResourceType=='AWS::Logs::LogGroup'].PhysicalResourceId",
    ],
    { profile, region },
  );

  return response
    .filter((value) => typeof value === "string")
    .sort((left, right) => left.localeCompare(right));
}

function buildDefaultQuery(options, limit) {
  const filters = [];

  if (options.requestId) {
    filters.push(`@message like /${escapeRegex(options.requestId)}/`);
  }

  if (options.contains) {
    filters.push(`@message like /${escapeRegex(options.contains)}/`);
  }

  if (options.level) {
    const level = options.level.toLowerCase();
    if (level === "error") {
      filters.push(
        "@message like /ERROR|Error|error|Exception|exception|Task timed out|Runtime/",
      );
    } else if (level === "warn" || level === "warning") {
      filters.push("@message like /WARN|Warn|warn|WARNING|Warning|warning/");
    } else {
      filters.push(`@message like /${escapeRegex(options.level)}/`);
    }
  }

  if (filters.length === 0) {
    filters.push(
      "@message like /ERROR|Error|error|Exception|exception|Task timed out|Runtime/",
    );
  }

  return [
    "fields @timestamp, @log, @logStream, @message",
    ...filters.map((filter) => `filter ${filter}`),
    "sort @timestamp desc",
    `limit ${limit}`,
  ].join(" | ");
}

function escapeRegex(value) {
  return value.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
}

function runInsightsQuery({
  logGroups,
  region,
  profile,
  queryString,
  since,
  limit,
}) {
  const endTime = Math.floor(Date.now() / 1000);
  const startTime = endTime - parseDurationSeconds(since);

  console.error(
    `Querying ${logGroups.length} log group(s) in ${region} for the last ${since}...`,
  );
  console.error(queryString);

  const startResponse = awsJson(
    [
      "logs",
      "start-query",
      "--start-time",
      String(startTime),
      "--end-time",
      String(endTime),
      "--query-string",
      queryString,
      "--log-group-names",
      ...logGroups,
      "--limit",
      String(limit),
    ],
    { profile, region },
  );

  const queryId = startResponse.queryId;
  if (!queryId) {
    fail("CloudWatch Logs did not return a queryId.");
  }

  let response;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    sleep(1000);
    response = awsJson(
      ["logs", "get-query-results", "--query-id", queryId],
      { profile, region },
    );

    if (response.status === "Complete") {
      printResults(response.results ?? []);
      return;
    }

    if (["Failed", "Cancelled", "Timeout"].includes(response.status)) {
      fail(`Query ${queryId} ended with status ${response.status}.`);
    }
  }

  fail(`Timed out waiting for query ${queryId}.`);
}

function runLiveTail({ logGroups, region, profile, filter }) {
  const args = [
    "logs",
    "start-live-tail",
    "--log-group-identifiers",
    ...logGroups,
  ];

  if (filter) {
    args.push("--log-event-filter-pattern", filter);
  }

  if (region) {
    args.push("--region", region);
  }
  if (profile) {
    args.push("--profile", profile);
  }

  console.error(
    `Live tailing ${logGroups.length} log group(s) in ${region}. Press Ctrl+C to stop.`,
  );
  const result = spawnSync("aws", args, {
    encoding: "utf8",
    stdio: "inherit",
  });

  if (result.error) {
    fail(result.error.message);
  }

  process.exit(result.status ?? 1);
}

function parseDurationSeconds(value) {
  const match = String(value).match(/^(\d+)([smhd])$/);
  if (!match) {
    fail("--since must look like 15m, 1h, or 2d.");
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 24 * 60 * 60,
  };

  return amount * multipliers[unit];
}

function printResults(results) {
  if (results.length === 0) {
    console.log("No matching log events.");
    return;
  }

  for (const row of results) {
    const fields = Object.fromEntries(
      row.map(({ field, value }) => [field, value]),
    );
    const timestamp = fields["@timestamp"] ?? "";
    const log = shortLogName(fields["@log"] ?? "");
    const stream = fields["@logStream"] ?? "";
    const message = fields["@message"] ?? "";

    console.log(`\n${timestamp} ${log} ${stream}`);
    console.log(message.trimEnd());
  }
}

function shortLogName(value) {
  return value.replace(/^\d+:/, "");
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function printHelp() {
  console.log(`Usage:
  npm run logs -- [query] [options]
  npm run logs:tail -- [options]
  npm run logs:groups -- [options]

Commands:
  query               Query recent errors with CloudWatch Logs Insights.
  tail                Stream new log events with CloudWatch Logs Live Tail.
  groups              Print discovered backend log groups.

Options:
  --since 30m         Query lookback window. Supports s, m, h, d. Default: 30m.
  --level error       Filter level. Built-ins: error, warn. Default: error.
  --contains text     Match text in @message.
  --request-id id     Match a request id in @message.
  --filter pattern    Live Tail filter pattern.
  --query query       Full Logs Insights query string.
  --limit 50          Maximum query results. Default: 50.
  --stack name        CloudFormation stack name. Default: PersonalAlbumStack.
  --region region     AWS region. Default: AWS_REGION, AWS_DEFAULT_REGION, ap-southeast-2.
  --profile profile   AWS profile.
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
