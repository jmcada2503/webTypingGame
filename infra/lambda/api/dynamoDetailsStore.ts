import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { DetailsResult, DetailsStore } from "./metrics";

/** `match_details`: pk `pid`, sk `<at>#<id>`. No TTL: it is the player's history. */
export class DynamoDetailsStore implements DetailsStore {
  private readonly db: DynamoDBDocumentClient;

  constructor(
    private readonly table: string,
    // No retries: over the provisioned capacity the item is dropped (the log line still goes out).
    client = new DynamoDBClient({ maxAttempts: 1 }),
  ) {
    this.db = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  }

  async put(item: { pid: string; sk: string } & Record<string, unknown>): Promise<DetailsResult> {
    try {
      await this.db.send(
        new PutCommand({
          TableName: this.table,
          Item: item,
          ConditionExpression: "attribute_not_exists(sk)",
        }),
      );
      return "ok";
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === "ConditionalCheckFailedException") return "duplicate";
      if (name === "ProvisionedThroughputExceededException" || name === "ThrottlingException") return "throttled";
      throw error;
    }
  }
}
