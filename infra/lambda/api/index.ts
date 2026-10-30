import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { DynamoPresenceStore } from "./dynamoPresenceStore";
import { DynamoStore } from "./dynamoStore";
import { MemoryStore } from "./memoryStore";
import { MemoryPresenceStore, Presence } from "./presence";
import { createRouter } from "./routes";
import { Matchmaker } from "./service";

/** Requests are tiny (a pid, a language, at most one 8 KB description). */
const MAX_BODY_BYTES = 16 * 1024;

const matches = process.env.MATCHES_TABLE;
const presence = process.env.PRESENCE_TABLE;
const route = createRouter(
  new Matchmaker(matches ? new DynamoStore(matches) : new MemoryStore()),
  new Presence(presence ? new DynamoPresenceStore(presence) : new MemoryPresenceStore()),
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

  const { status, body: out, headers } = await route({ method, path, query: event.queryStringParameters ?? {}, body });
  return reply(status, out, headers);
};
