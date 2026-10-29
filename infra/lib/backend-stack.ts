import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { Architecture, FunctionUrlAuthType, Runtime, type FunctionUrl } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { RetentionDays, LogGroup } from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

/** Rate cap: more concurrent requests than this get throttled ("Busy, try again"). */
export const API_CONCURRENCY = 10;
export const API_MEMORY_MB = 256;

export class BackendStack extends Stack {
  readonly api: NodejsFunction;
  readonly apiUrl: FunctionUrl;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const logGroup = new LogGroup(this, "ApiLogs", {
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
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
    });

    // IAM auth: only CloudFront can call it (OAC permission is added by the Static stack).
    this.apiUrl = this.api.addFunctionUrl({ authType: FunctionUrlAuthType.AWS_IAM });
  }
}
