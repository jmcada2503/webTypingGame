import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { Architecture, FunctionUrlAuthType, Runtime, type FunctionUrl } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { CfnQueryDefinition, LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import { TURN_PARAMS } from "../lambda/api/turn";
import { METRICS_QUERIES } from "./metrics-queries";

/** Rate cap: more concurrent requests than this get throttled ("Busy, try again"). */
export const API_CONCURRENCY = 10;
export const API_MEMORY_MB = 256;
/** Share of metrics reports kept (1 = all, 0 = off). The kill switch: change it here and deploy. */
export const METRICS_SAMPLE_RATE = 1;

export class BackendStack extends Stack {
  readonly api: NodejsFunction;
  readonly matches: Table;
  readonly presence: Table;
  readonly matchDetails: Table;
  readonly apiUrl: FunctionUrl;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const logGroup = new LogGroup(this, "ApiLogs", {
      // The metrics live here too (one JSON line each, see lambda/api/metrics.ts): half a year of trends.
      retention: RetentionDays.SIX_MONTHS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Provisioned, not on-demand: 25 read + 25 write units are free account-wide, so a flood throttles
    // instead of billing. Split: matches 10 R / 10 W, presence 2 R / 3 W, match_details 10 R / 12 W (3 R spare).
    this.matches = new Table(this, "Matches", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      billingMode: BillingMode.PROVISIONED,
      readCapacity: 10,
      writeCapacity: 10,
      // Cleanup only: deletes lag by up to ~48 h, liveness is checked in code.
      timeToLiveAttribute: "ttl",
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // One counter per language per 60 s window. Writes: one per open tab per window, and tabs sample themselves
    // above 50 (about 50 writes a minute, under 1/s). Reads: rare, the online count is CloudFront-cached.
    this.presence = new Table(this, "Presence", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      billingMode: BillingMode.PROVISIONED,
      readCapacity: 2,
      writeCapacity: 3,
      timeToLiveAttribute: "ttl",
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // The player's history: one item per player per Match / Practice run (~1-3 KB = 1-3 write units each,
    // so ~4-12 reports/s). Over that the item is dropped and only the log line stays. No TTL.
    this.matchDetails = new Table(this, "MatchDetails", {
      partitionKey: { name: "pid", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      billingMode: BillingMode.PROVISIONED,
      readCapacity: 10,
      writeCapacity: 12,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.api = new NodejsFunction(this, "Api", {
      entry: "lambda/api/index.ts",
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: API_MEMORY_MB,
      timeout: Duration.seconds(10),
      // The Guardrails stack sets this to 0 while resting; CloudFormation leaves it alone
      // on later deploys as long as this value doesn't change.
      reservedConcurrentExecutions: API_CONCURRENCY,
      logGroup,
      environment: {
        MATCHES_TABLE: this.matches.tableName,
        PRESENCE_TABLE: this.presence.tableName,
        MATCH_DETAILS_TABLE: this.matchDetails.tableName,
        METRICS_SAMPLE_RATE: String(METRICS_SAMPLE_RATE),
      },
    });
    this.matches.grantReadWriteData(this.api);
    this.presence.grantReadWriteData(this.api);
    this.matchDetails.grantWriteData(this.api);

    // TURN relay (Cloudflare): the key id and its API token are set by hand (a SecureString can't be made
    // here); without them the game stays STUN-only. The switch is the kill switch: set it to anything but
    // `on` (`aws ssm put-parameter --name /typing-game/turn/enabled --value off --overwrite`) and no new relay
    // logins go out within a minute. Deploys leave a hand-set value alone while this one doesn't change.
    new StringParameter(this, "TurnEnabled", {
      parameterName: TURN_PARAMS.enabled,
      stringValue: "on",
      description: "TURN relay switch: on = paired players get Cloudflare relay logins",
    });
    this.api.addToRolePolicy(
      new PolicyStatement({
        actions: ["ssm:GetParameters"],
        resources: Object.values(TURN_PARAMS).map((name) => this.formatArn({ service: "ssm", resource: "parameter", resourceName: name.slice(1) })),
      }),
    );

    for (const [name, queryString] of Object.entries(METRICS_QUERIES)) {
      new CfnQueryDefinition(this, `Query${name.replace(/[^A-Za-z0-9]/g, "")}`, {
        name: `typing-game/${name}`,
        queryString,
        logGroupNames: [logGroup.logGroupName],
      });
    }

    // IAM auth: only CloudFront can call it (OAC permission is added by the Static stack).
    this.apiUrl = this.api.addFunctionUrl({ authType: FunctionUrlAuthType.AWS_IAM });
  }
}
