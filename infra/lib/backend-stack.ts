import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { CfnBudget } from "aws-cdk-lib/aws-budgets";
import { Architecture, FunctionUrlAuthType, Runtime, type FunctionUrl } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { RetentionDays, LogGroup } from "aws-cdk-lib/aws-logs";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";

export const MONTHLY_LIMIT_USD = 5;
const BUDGET_ALERT_PERCENTS = [20, 60, 100];

interface BackendStackProps extends StackProps {
  budgetEmail: string;
}

export class BackendStack extends Stack {
  readonly apiUrl: FunctionUrl;

  constructor(scope: Construct, id: string, props: BackendStackProps) {
    super(scope, id, props);

    const logGroup = new LogGroup(this, "ApiLogs", {
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const api = new NodejsFunction(this, "Api", {
      entry: "lambda/api/index.ts",
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      // Rate cap: more concurrent requests than this get throttled ("Busy, try again").
      reservedConcurrentExecutions: 10,
      logGroup,
    });

    // IAM auth: only CloudFront can call it (OAC permission is added by the Static stack).
    this.apiUrl = api.addFunctionUrl({ authType: FunctionUrlAuthType.AWS_IAM });

    // CloudFormation only rewrites this when the value here changes, so
    // out-of-band limit changes (guardrails scripts) survive ordinary deploys.
    new StringParameter(this, "MonthlyLimit", {
      parameterName: "/typing-game/monthly-limit-usd",
      stringValue: String(MONTHLY_LIMIT_USD),
    });

    new CfnBudget(this, "MonthlyBudget", {
      budget: {
        budgetName: "typing-game-monthly",
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: MONTHLY_LIMIT_USD, unit: "USD" },
      },
      notificationsWithSubscribers: BUDGET_ALERT_PERCENTS.map((threshold) => ({
        notification: {
          notificationType: "ACTUAL",
          comparisonOperator: "GREATER_THAN",
          thresholdType: "PERCENTAGE",
          threshold,
        },
        subscribers: [{ subscriptionType: "EMAIL", address: props.budgetEmail }],
      })),
    });
  }
}
