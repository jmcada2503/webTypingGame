import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { CfnBudget } from "aws-cdk-lib/aws-budgets";
import { Alarm, ComparisonOperator, Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import type { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { Rule, RuleTargetInput, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Architecture, Runtime, type IFunction } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import type { Bucket } from "aws-cdk-lib/aws-s3";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription, LambdaSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import { API_CONCURRENCY, API_MEMORY_MB } from "./backend-stack";

// Names the guardrails scripts (scripts/guardrails.ts) use to find these resources.
export const MONTHLY_LIMIT_USD = 5;
export const LIMIT_PARAM = "/typing-game/monthly-limit-usd";
export const BUDGET_NAME = "typing-game-monthly";
export const BILLING_ALARM_NAME = "typing-game-estimated-charges";
export const GUARDRAILS_FUNCTION = "typing-game-guardrails";

const EMAIL_ALERT_PERCENTS = [20, 60];

interface GuardrailsStackProps extends StackProps {
  api: IFunction;
  bucket: Bucket;
  distribution: Distribution;
  budgetEmail: string;
}

export class GuardrailsStack extends Stack {
  constructor(scope: Construct, id: string, props: GuardrailsStackProps) {
    super(scope, id, props);
    const { api, bucket, distribution, budgetEmail } = props;

    // CloudFormation only rewrites the limit, budget amount and alarm threshold when the
    // value here changes, so `guardrails:limit` survives ordinary deploys.
    const limit = new StringParameter(this, "MonthlyLimit", {
      parameterName: LIMIT_PARAM,
      stringValue: String(MONTHLY_LIMIT_USD),
    });

    const guardrails = new NodejsFunction(this, "Guardrails", {
      functionName: GUARDRAILS_FUNCTION,
      entry: "lambda/guardrails/index.ts",
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(30),
      // One at a time: a scheduled check and an SNS trip never race on /status.json.
      reservedConcurrentExecutions: 1,
      logGroup: new LogGroup(this, "GuardrailsLogs", {
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: {
        SITE_BUCKET: bucket.bucketName,
        DISTRIBUTION_ID: distribution.distributionId,
        API_FUNCTION: api.functionName,
        API_CONCURRENCY: String(API_CONCURRENCY),
        LIMIT_PARAM,
        LAMBDA_GB: String(API_MEMORY_MB / 1024),
      },
    });
    limit.grantRead(guardrails);
    bucket.grantReadWrite(guardrails, "status.json");
    // Lets a missing status.json read as NoSuchKey instead of AccessDenied.
    guardrails.addToRolePolicy(new PolicyStatement({ actions: ["s3:ListBucket"], resources: [bucket.bucketArn] }));
    distribution.grantCreateInvalidation(guardrails);
    guardrails.addToRolePolicy(
      new PolicyStatement({ actions: ["lambda:PutFunctionConcurrency"], resources: [api.functionArn] }),
    );
    guardrails.addToRolePolicy(new PolicyStatement({ actions: ["cloudwatch:GetMetricStatistics"], resources: ["*"] }));

    new Rule(this, "Check", {
      schedule: Schedule.rate(Duration.minutes(15)),
      targets: [new LambdaFunction(guardrails)],
    });
    new Rule(this, "MonthlyLift", {
      schedule: Schedule.cron({ minute: "5", hour: "0", day: "1" }),
      targets: [new LambdaFunction(guardrails, { event: RuleTargetInput.fromObject({ action: "lift" }) })],
    });

    // Budgets at 100% and the billing alarm both force a trip through this topic.
    const trip = new Topic(this, "Trip");
    trip.addSubscription(new LambdaSubscription(guardrails));
    trip.addSubscription(new EmailSubscription(budgetEmail));
    trip.addToResourcePolicy(
      new PolicyStatement({
        actions: ["sns:Publish"],
        principals: [new ServicePrincipal("budgets.amazonaws.com")],
        resources: [trip.topicArn],
      }),
    );

    const email = { subscriptionType: "EMAIL", address: budgetEmail };
    const actualOver = (threshold: number) => ({
      notificationType: "ACTUAL",
      comparisonOperator: "GREATER_THAN",
      thresholdType: "PERCENTAGE",
      threshold,
    });
    new CfnBudget(this, "MonthlyBudget", {
      budget: {
        budgetName: BUDGET_NAME,
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: MONTHLY_LIMIT_USD, unit: "USD" },
        costTypes: { includeCredit: false },
      },
      notificationsWithSubscribers: [
        ...EMAIL_ALERT_PERCENTS.map((p) => ({ notification: actualOver(p), subscribers: [email] })),
        { notification: actualOver(100), subscribers: [email, { subscriptionType: "SNS", address: trip.topicArn }] },
      ],
    });

    // Needs "Receive CloudWatch billing alerts" on in Billing preferences; until then it has no data.
    new Alarm(this, "EstimatedCharges", {
      alarmName: BILLING_ALARM_NAME,
      metric: new Metric({
        namespace: "AWS/Billing",
        metricName: "EstimatedCharges",
        dimensionsMap: { Currency: "USD" },
        statistic: "Maximum",
        period: Duration.hours(6),
      }),
      threshold: MONTHLY_LIMIT_USD,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(new SnsAction(trip));
  }
}
