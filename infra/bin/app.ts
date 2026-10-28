import { App } from "aws-cdk-lib";
import { BackendStack } from "../lib/backend-stack";
import { StaticStack } from "../lib/static-stack";

const app = new App();

const budgetEmail = process.env.BUDGET_EMAIL;
if (!budgetEmail) throw new Error("BUDGET_EMAIL is required: budget alerts go to this address");

const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: "us-east-1" };

// Static depends on Backend (CloudFront routes /api/* to the Function URL), never the reverse.
const backend = new BackendStack(app, "Backend", { env, budgetEmail });
new StaticStack(app, "Static", { env, apiUrl: backend.apiUrl });
