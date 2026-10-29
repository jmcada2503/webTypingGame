import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { Language, Match, Store } from "./types";

const QUEUE_TTL_SECONDS = 3600;

/** `Q#<lang>` is the waiting pointer, `M#<id>` a match; one table, one `pk`. TTL is cleanup only. */
const queueKey = (lang: Language) => `Q#${lang}`;
const matchKey = (id: string) => `M#${id}`;

const conditionFailed = (error: unknown) => error instanceof ConditionalCheckFailedException;

export class DynamoStore implements Store {
  private readonly db: DynamoDBDocumentClient;

  constructor(
    private readonly table: string,
    client = new DynamoDBClient({}),
  ) {
    this.db = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  }

  async takeQueue(lang: Language) {
    const out = await this.db.send(
      new DeleteCommand({ TableName: this.table, Key: { pk: queueKey(lang) }, ReturnValues: "ALL_OLD" }),
    );
    return (out.Attributes?.matchId as string | undefined) ?? null;
  }

  async putQueue(lang: Language, matchId: string) {
    try {
      await this.db.send(
        new PutCommand({
          TableName: this.table,
          Item: { pk: queueKey(lang), matchId, ttl: Math.floor(Date.now() / 1000) + QUEUE_TTL_SECONDS },
          ConditionExpression: "attribute_not_exists(pk)",
        }),
      );
      return true;
    } catch (error) {
      if (conditionFailed(error)) return false;
      throw error;
    }
  }

  async clearQueue(lang: Language, matchId: string) {
    try {
      await this.db.send(
        new DeleteCommand({
          TableName: this.table,
          Key: { pk: queueKey(lang) },
          ConditionExpression: "matchId = :id",
          ExpressionAttributeValues: { ":id": matchId },
        }),
      );
    } catch (error) {
      if (!conditionFailed(error)) throw error;
    }
  }

  async get(id: string, consistent = true) {
    const out = await this.db.send(
      new GetCommand({ TableName: this.table, Key: { pk: matchKey(id) }, ConsistentRead: consistent }),
    );
    if (!out.Item) return null;
    const { pk: _pk, ...match } = out.Item;
    return match as Match;
  }

  async create(match: Match) {
    await this.db.send(
      new PutCommand({
        TableName: this.table,
        Item: { pk: matchKey(match.id), ...match },
        ConditionExpression: "attribute_not_exists(pk)",
      }),
    );
  }

  async claim(id: string, guest: string, seeds: { host: number; guest: number }, now: number) {
    try {
      const out = await this.db.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { pk: matchKey(id) },
          UpdateExpression: "SET guest = :guest, #status = :paired, seedHost = :sh, seedGuest = :sg, guestSeen = :now",
          ConditionExpression: "attribute_exists(pk) AND #status = :waiting AND attribute_not_exists(guest)",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":guest": guest,
            ":paired": "paired",
            ":waiting": "waiting",
            ":sh": seeds.host,
            ":sg": seeds.guest,
            ":now": now,
          },
          ReturnValues: "ALL_NEW",
        }),
      );
      const { pk: _pk, ...match } = out.Attributes!;
      return match as Match;
    } catch (error) {
      if (conditionFailed(error)) return null;
      throw error;
    }
  }

  async update(id: string, fields: Partial<Match>) {
    const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
    if (entries.length === 0) return;
    try {
      await this.db.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { pk: matchKey(id) },
          UpdateExpression: `SET ${entries.map(([key], i) => `#k${i} = :v${i}`).join(", ")}`,
          ConditionExpression: "attribute_exists(pk)",
          ExpressionAttributeNames: Object.fromEntries(entries.map(([key], i) => [`#k${i}`, key])),
          ExpressionAttributeValues: Object.fromEntries(entries.map(([, value], i) => [`:v${i}`, value])),
        }),
      );
    } catch (error) {
      if (!conditionFailed(error)) throw error;
    }
  }

  async delete(id: string) {
    await this.db.send(new DeleteCommand({ TableName: this.table, Key: { pk: matchKey(id) } }));
  }
}
