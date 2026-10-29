// Month-to-date cost estimate from CloudWatch usage, net of AWS always-free allowances.
// Prices are us-east-1 list prices; CloudFront uses the worst region (South America),
// so the estimate errs high wherever players actually are.

/** Month-to-date usage summed from CloudWatch metrics. */
export interface Usage {
  cloudfrontRequests: number;
  cloudfrontGb: number;
  lambdaRequests: number;
  lambdaGbSeconds: number;
  logsGb: number;
}

export const PRICES = {
  cloudfrontPerRequest: 2.2 / 1_000_000,
  cloudfrontPerGb: 0.12,
  lambdaPerRequest: 0.2 / 1_000_000,
  lambdaPerGbSecond: 0.0000133334, // arm64
  logsPerGb: 0.5,
  /** S3 storage and requests, SNS, SSM: cents, never metered here. */
  fixedPerMonth: 0.1,
};

export const FREE: Usage = {
  cloudfrontRequests: 10_000_000,
  cloudfrontGb: 1000,
  lambdaRequests: 1_000_000,
  lambdaGbSeconds: 400_000,
  logsGb: 5,
};

/** Servers rest once the estimate reaches this share of the monthly limit. */
export const TRIP_FRACTION = 0.8;

const billable = (used: number, free: number) => Math.max(0, used - free);

export function estimateUsd(usage: Usage): number {
  return (
    PRICES.fixedPerMonth +
    billable(usage.cloudfrontRequests, FREE.cloudfrontRequests) * PRICES.cloudfrontPerRequest +
    billable(usage.cloudfrontGb, FREE.cloudfrontGb) * PRICES.cloudfrontPerGb +
    billable(usage.lambdaRequests, FREE.lambdaRequests) * PRICES.lambdaPerRequest +
    billable(usage.lambdaGbSeconds, FREE.lambdaGbSeconds) * PRICES.lambdaPerGbSecond +
    billable(usage.logsGb, FREE.logsGb) * PRICES.logsPerGb
  );
}

export function shouldTrip(estimateUsd: number, limitUsd: number): boolean {
  return estimateUsd >= limitUsd * TRIP_FRACTION;
}

export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
