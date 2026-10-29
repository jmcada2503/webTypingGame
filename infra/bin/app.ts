import { App } from "aws-cdk-lib";
import { BackendStack } from "../lib/backend-stack";
import { GuardrailsStack } from "../lib/guardrails-stack";
import { StaticStack } from "../lib/static-stack";

const app = new App();

const budgetEmail = process.env.BUDGET_EMAIL;
if (!budgetEmail) throw new Error("BUDGET_EMAIL is required: budget alerts go to this address");

const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: "us-east-1" };

// Dependencies only point down this list: Static routes /api/* to Backend, and Guardrails
// watches both (writes /status.json, throttles the api).
const backend = new BackendStack(app, "Backend", { env });
const site = new StaticStack(app, "Static", { env, apiUrl: backend.apiUrl });
new GuardrailsStack(app, "Guardrails", {
  env,
  api: backend.api,
  bucket: site.bucket,
  distribution: site.distribution,
  budgetEmail,
});
