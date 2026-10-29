import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { BUCKET_MS, type PresenceStore } from "./presence";
import type { Language } from "./types";

/** Windows are read for a minute at most; TTL (cleanup only, it lags) clears them after ~10 min. */
const TTL_SECONDS = 600;

const key = (lang: Language, window: number) => ({ pk: `P#${lang}#${window}` });

export class DynamoPresenceStore implements PresenceStore {
  private readonly db: DynamoDBDocumentClient;

  constructor(
    private readonly table: string,
    client = new DynamoDBClient({}),
  ) {
    this.db = DynamoDBDocumentClient.from(client);
  }

  async bump(lang: Language, window: number) {
    await this.db.send(
      new UpdateCommand({
        TableName: this.table,
        Key: key(lang, window),
        UpdateExpression: "ADD n :one SET #ttl = :ttl",
        ExpressionAttributeNames: { "#ttl": "ttl" },
        ExpressionAttributeValues: { ":one": 1, ":ttl": Math.floor((window * BUCKET_MS) / 1000) + TTL_SECONDS },
      }),
    );
  }

  async count(lang: Language, window: number) {
    const out = await this.db.send(new GetCommand({ TableName: this.table, Key: key(lang, window) }));
    return (out.Item?.n as number | undefined) ?? 0;
  }
}
