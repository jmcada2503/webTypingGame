import { describe, expect, it } from "vitest";
import { estimateUsd, monthStart, shouldTrip, TRIP_FRACTION, type Usage } from "./estimate";

const NONE: Usage = { cloudfrontRequests: 0, cloudfrontGb: 0, lambdaRequests: 0, lambdaGbSeconds: 0, logsGb: 0 };

describe("estimateUsd", () => {
  it("is only the fixed baseline when nothing was used", () => {
    expect(estimateUsd(NONE)).toBeCloseTo(0.1, 6);
  });

  it("is free while every service stays inside its always-free allowance", () => {
    const inside: Usage = {
      cloudfrontRequests: 10_000_000,
      cloudfrontGb: 1000,
      lambdaRequests: 1_000_000,
      lambdaGbSeconds: 400_000,
      logsGb: 5,
    };
    expect(estimateUsd(inside)).toBeCloseTo(0.1, 6);
  });

  it("charges CloudFront requests past 10M at the worst-region price", () => {
    expect(estimateUsd({ ...NONE, cloudfrontRequests: 11_000_000 })).toBeCloseTo(0.1 + 2.2, 6);
  });

  it("charges CloudFront data past 1 TB at the worst-region price", () => {
    expect(estimateUsd({ ...NONE, cloudfrontGb: 1010 })).toBeCloseTo(0.1 + 10 * 0.12, 6);
  });

  it("charges Lambda requests and arm64 compute past their free allowance", () => {
    const usd = estimateUsd({ ...NONE, lambdaRequests: 2_000_000, lambdaGbSeconds: 500_000 });
    expect(usd).toBeCloseTo(0.1 + 0.2 + 100_000 * 0.0000133334, 6);
  });

  it("charges log ingestion past 5 GB", () => {
    expect(estimateUsd({ ...NONE, logsGb: 7 })).toBeCloseTo(0.1 + 2 * 0.5, 6);
  });

  it("adds every service together", () => {
    const usd = estimateUsd({
      cloudfrontRequests: 12_000_000,
      cloudfrontGb: 1000,
      lambdaRequests: 3_000_000,
      lambdaGbSeconds: 0,
      logsGb: 6,
    });
    expect(usd).toBeCloseTo(0.1 + 4.4 + 0.4 + 0.5, 6);
  });
});

describe("shouldTrip", () => {
  it(`trips at ${TRIP_FRACTION * 100}% of the limit`, () => {
    expect(shouldTrip(3.99, 5)).toBe(false);
    expect(shouldTrip(4, 5)).toBe(true);
    expect(shouldTrip(4.5, 5)).toBe(true);
  });

  it("follows a raised limit", () => {
    expect(shouldTrip(4.5, 10)).toBe(false);
  });
});

describe("monthStart", () => {
  it("is midnight UTC on the 1st of the current month", () => {
    expect(monthStart(new Date("2026-10-28T22:15:00Z")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(monthStart(new Date("2026-11-01T00:00:00Z")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
});
