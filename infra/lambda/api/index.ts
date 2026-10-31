import { SSMClient } from "@aws-sdk/client-ssm";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { DynamoDetailsStore } from "./dynamoDetailsStore";
import { DynamoPresenceStore } from "./dynamoPresenceStore";
import { DynamoStore } from "./dynamoStore";
import { MemoryStore } from "./memoryStore";
import { MemoryDetailsStore, Metrics } from "./metrics";
import { MemoryPresenceStore, Presence } from "./presence";
import { createRouter } from "./routes";
import { Matchmaker } from "./service";
import { CloudflareTurn, NO_TURN, cachedConfig, ssmTurnConfig } from "./turn";

/** Requests are small (a pid, a language, at most one 8 KB description or one Match report). */
const MAX_BODY_BYTES = 16 * 1024;

/**
 * One log event that is pure JSON. `console.log` adds a timestamp / request id / level prefix that hides the
 * fields from Logs Insights; a raw stdout line keeps them (queries use `t`, `pid`, ... directly).
 */
const logLine = (line: Record<string, unknown>) => void process.stdout.write(`${JSON.stringify(line)}\n`);

const matches = process.env.MATCHES_TABLE;
const presence = process.env.PRESENCE_TABLE;
const details = process.env.MATCH_DETAILS_TABLE;
const sampleRate = Number(process.env.METRICS_SAMPLE_RATE ?? "1");
/** A relay login outlasts any session (an active relay needs it to stay up); rematches can run for hours. */
const TURN_TTL_SECONDS = 6 * 3600;
// In the cloud the relay is set up through SSM (`TURN_PARAMS`); locally there is none.
const turn = matches
  ? new CloudflareTurn({ config: cachedConfig(ssmTurnConfig(new SSMClient({}))), log: logLine, ttlSeconds: TURN_TTL_SECONDS })
  : NO_TURN;
const route = createRouter(
  new Matchmaker(matches ? new DynamoStore(matches) : new MemoryStore(), { turn }),
  new Presence(presence ? new DynamoPresenceStore(presence) : new MemoryPresenceStore(), { log: logLine }),
  new Metrics({
    store: details ? new DynamoDetailsStore(details) : new MemoryDetailsStore(),
    log: logLine,
    sampleRate: Number.isFinite(sampleRate) ? sampleRate : 1,
  }),
);

const reply = (status: number, body: unknown, headers: Record<string, string> = {}): APIGatewayProxyResultV2 => ({
  statusCode: status,
  headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  body: JSON.stringify(body),
});

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const { method, path } = event.requestContext.http;

  let body: unknown;
  if (event.body) {
    const text = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString() : event.body;
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) return reply(413, { error: "too_large" });
    try {
      body = JSON.parse(text);
    } catch {
      return reply(400, { error: "invalid" });
    }
  }

  const country = event.headers?.["cloudfront-viewer-country"];
  const { status, body: out, headers } = await route({ method, path, query: event.queryStringParameters ?? {}, body, country });
  return reply(status, out, headers);
};
