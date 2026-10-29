import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import { CloudWatchClient, GetMetricStatisticsCommand, type Dimension } from "@aws-sdk/client-cloudwatch";
import { LambdaClient, PutFunctionConcurrencyCommand } from "@aws-sdk/client-lambda";
import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import type { SNSEvent } from "aws-lambda";
import { estimateUsd, monthStart, shouldTrip, type Usage } from "./estimate";

// One function, several triggers: the schedule checks the estimate, Budgets and the billing
// alarm (via SNS) force a trip, the 1st of the month and the resume script lift it.

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const BUCKET = env("SITE_BUCKET");
const DISTRIBUTION_ID = env("DISTRIBUTION_ID");
const API_FUNCTION = env("API_FUNCTION");
const API_CONCURRENCY = Number(env("API_CONCURRENCY"));
const LIMIT_PARAM = env("LIMIT_PARAM");
/** Account-wide Lambda Duration has no memory size: price it at the largest function's. */
const LAMBDA_GB = Number(env("LAMBDA_GB"));

const STATUS_KEY = "status.json";

const s3 = new S3Client({});
const cloudfront = new CloudFrontClient({});
const cloudwatch = new CloudWatchClient({});
const lambda = new LambdaClient({});
const ssm = new SSMClient({});

export interface ServerStatus {
  resting: boolean;
  reason: string | null;
  since: string;
}

type ManualEvent = { action: "check" | "resume" | "lift" };
type ScheduledEvent = { "detail-type": "Scheduled Event" };
type GuardrailsEvent = ManualEvent | ScheduledEvent | SNSEvent;

export const handler = async (event: GuardrailsEvent) => {
  // CloudWatch alarms publish JSON with an AlarmName; Budgets publishes plain text.
  if ("Records" in event) return trip(event.Records[0]?.Sns.Message.includes('"AlarmName"') ? "billing-alarm" : "budget");
  if ("action" in event && event.action !== "check") return resume(event.action);
  return check();
};

async function check() {
  const status = (await readStatus()) ?? (await writeStatus(false, null));
  const { estimate, limit, usage } = await currentEstimate();
  log("check", { estimate, limit, usage, resting: status.resting });
  // Re-applied while resting too, in case a deploy restored the api's concurrency.
  if (status.resting || shouldTrip(estimate, limit)) return trip(status.reason ?? "estimate");
  return { resting: status.resting, estimate, limit };
}

async function trip(reason: string) {
  // Concurrency first: it stops the spend even if the status write fails.
  await lambda.send(new PutFunctionConcurrencyCommand({ FunctionName: API_FUNCTION, ReservedConcurrentExecutions: 0 }));
  const status = await readStatus();
  if (!status?.resting) await writeStatus(true, reason);
  log("trip", { reason, wasResting: status?.resting ?? false });
  return { resting: true, reason };
}

/** Lifts resting unless the estimate would trip again right away. */
async function resume(action: "resume" | "lift") {
  const { estimate, limit } = await currentEstimate();
  if (shouldTrip(estimate, limit)) {
    log("resume-refused", { action, estimate, limit });
    return { resting: true, refused: true, estimate, limit };
  }
  await lambda.send(
    new PutFunctionConcurrencyCommand({ FunctionName: API_FUNCTION, ReservedConcurrentExecutions: API_CONCURRENCY }),
  );
  const status = await readStatus();
  if (status?.resting !== false) await writeStatus(false, null);
  log("resume", { action, estimate, limit });
  return { resting: false, estimate, limit };
}

async function currentEstimate() {
  const [usage, limit] = await Promise.all([monthUsage(), readLimit()]);
  return { usage, limit, estimate: estimateUsd(usage) };
}

async function readLimit(): Promise<number> {
  const out = await ssm.send(new GetParameterCommand({ Name: LIMIT_PARAM }));
  const limit = Number(out.Parameter?.Value);
  if (!Number.isFinite(limit) || limit <= 0) throw new Error(`bad limit in ${LIMIT_PARAM}: ${out.Parameter?.Value}`);
  return limit;
}

async function monthUsage(): Promise<Usage> {
  const cloudfrontDims = [
    { Name: "DistributionId", Value: DISTRIBUTION_ID },
    { Name: "Region", Value: "Global" },
  ];
  const [cfRequests, cfBytes, lambdaRequests, lambdaMs, logBytes] = await Promise.all([
    monthSum("AWS/CloudFront", "Requests", cloudfrontDims),
    monthSum("AWS/CloudFront", "BytesDownloaded", cloudfrontDims),
    monthSum("AWS/Lambda", "Invocations"),
    monthSum("AWS/Lambda", "Duration"),
    monthSum("AWS/Logs", "IncomingBytes"),
  ]);
  const GB = 1024 ** 3;
  return {
    cloudfrontRequests: cfRequests,
    cloudfrontGb: cfBytes / GB,
    lambdaRequests,
    lambdaGbSeconds: (lambdaMs / 1000) * LAMBDA_GB,
    logsGb: logBytes / GB,
  };
}

/** Sum of a metric from the 1st of the month until now (no dimensions = account-wide). */
async function monthSum(namespace: string, metric: string, dimensions: Dimension[] = []): Promise<number> {
  const now = new Date();
  const out = await cloudwatch.send(
    new GetMetricStatisticsCommand({
      Namespace: namespace,
      MetricName: metric,
      Dimensions: dimensions,
      StartTime: monthStart(now),
      EndTime: now,
      Period: 86_400,
      Statistics: ["Sum"],
    }),
  );
  return (out.Datapoints ?? []).reduce((total, point) => total + (point.Sum ?? 0), 0);
}

async function readStatus(): Promise<ServerStatus | null> {
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: STATUS_KEY }));
    return JSON.parse(await out.Body!.transformToString()) as ServerStatus;
  } catch (err) {
    if (err instanceof NoSuchKey) return null;
    throw err;
  }
}

async function writeStatus(resting: boolean, reason: string | null): Promise<ServerStatus> {
  const status: ServerStatus = { resting, reason, since: new Date().toISOString() };
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: STATUS_KEY,
      Body: JSON.stringify(status),
      ContentType: "application/json",
      CacheControl: "max-age=30",
    }),
  );
  await cloudfront.send(
    new CreateInvalidationCommand({
      DistributionId: DISTRIBUTION_ID,
      InvalidationBatch: { CallerReference: `status-${Date.now()}`, Paths: { Quantity: 1, Items: [`/${STATUS_KEY}`] } },
    }),
  );
  return status;
}

const log = (action: string, fields: Record<string, unknown>) =>
  console.log(JSON.stringify({ event: "guardrails", action, ...fields }));
