// Operator commands for the cost guardrails (run as the admin user, not from CI):
//   npm run guardrails:limit -- <usd> [--resume]   change the monthly limit (SSM, budget, billing alarm)
//   npm run guardrails:resume                      lift "servers resting" (refused while still over the limit)
import { BudgetsClient, DescribeBudgetCommand, UpdateBudgetCommand } from "@aws-sdk/client-budgets";
import { CloudWatchClient, DescribeAlarmsCommand, PutMetricAlarmCommand } from "@aws-sdk/client-cloudwatch";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { PutParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { BILLING_ALARM_NAME, BUDGET_NAME, GUARDRAILS_FUNCTION, LIMIT_PARAM } from "../lib/guardrails-stack";

const region = "us-east-1";

async function setLimit(usd: number) {
  if (!Number.isFinite(usd) || usd <= 0) throw new Error(`limit must be a positive number of USD, got ${usd}`);

  await new SSMClient({ region }).send(
    new PutParameterCommand({ Name: LIMIT_PARAM, Value: String(usd), Overwrite: true }),
  );

  // Budget alerts are percentages, so they follow the new amount.
  const { Account } = await new STSClient({ region }).send(new GetCallerIdentityCommand({}));
  const budgets = new BudgetsClient({ region });
  const { Budget } = await budgets.send(new DescribeBudgetCommand({ AccountId: Account, BudgetName: BUDGET_NAME }));
  await budgets.send(
    new UpdateBudgetCommand({
      AccountId: Account,
      NewBudget: { ...Budget!, BudgetLimit: { Amount: String(usd), Unit: "USD" }, CalculatedSpend: undefined },
    }),
  );

  // PutMetricAlarm replaces the whole alarm, so resend it unchanged except the threshold.
  const cloudwatch = new CloudWatchClient({ region });
  const { MetricAlarms } = await cloudwatch.send(new DescribeAlarmsCommand({ AlarmNames: [BILLING_ALARM_NAME] }));
  const alarm = MetricAlarms?.[0];
  if (!alarm) throw new Error(`alarm ${BILLING_ALARM_NAME} not found`);
  await cloudwatch.send(
    new PutMetricAlarmCommand({
      AlarmName: alarm.AlarmName,
      AlarmDescription: alarm.AlarmDescription,
      ActionsEnabled: alarm.ActionsEnabled,
      AlarmActions: alarm.AlarmActions,
      OKActions: alarm.OKActions,
      InsufficientDataActions: alarm.InsufficientDataActions,
      Namespace: alarm.Namespace,
      MetricName: alarm.MetricName,
      Dimensions: alarm.Dimensions,
      Statistic: alarm.Statistic,
      Period: alarm.Period,
      EvaluationPeriods: alarm.EvaluationPeriods,
      ComparisonOperator: alarm.ComparisonOperator,
      TreatMissingData: alarm.TreatMissingData,
      Threshold: usd,
    }),
  );

  console.log(`limit set to $${usd} (SSM, budget, billing alarm)`);
}

async function resume() {
  const out = await new LambdaClient({ region }).send(
    new InvokeCommand({ FunctionName: GUARDRAILS_FUNCTION, Payload: JSON.stringify({ action: "resume" }) }),
  );
  const result = JSON.parse(new TextDecoder().decode(out.Payload));
  if (out.FunctionError) throw new Error(`guardrails failed: ${JSON.stringify(result)}`);
  if (result.refused) {
    console.error(
      `refused: estimate $${result.estimate.toFixed(2)} is still over the trip point for the $${result.limit} limit. ` +
        "Raise it first: npm run guardrails:limit -- <usd> --resume",
    );
    process.exit(1);
  }
  console.log(`resumed: estimate $${result.estimate.toFixed(2)} of $${result.limit}`);
}

const [command, ...args] = process.argv.slice(2);
if (command === "limit") {
  await setLimit(Number(args[0]));
  if (args.includes("--resume")) await resume();
} else if (command === "resume") {
  await resume();
} else {
  console.error("usage: guardrails.ts limit <usd> [--resume] | resume");
  process.exit(1);
}
