import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The root dev server (`vite.devApi.ts`) and its tests load these files from the game's root, where the AWS SDK
 * isn't installed (only `infra/` has it; CI runs the root tests first). So nothing they import may need it.
 */
// The dev server's imports, and every test file: the root test run picks up infra/'s tests too.
const ROOT_ENTRIES = ["memoryStore.ts", "metrics.ts", "presence.ts", "routes.ts", "service.ts"];

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gms)].map((m) => m[1]);
}

describe("code the root dev server and the root test run load", () => {
  it("never imports the AWS SDK, directly or through another file", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const seen = new Set<string>();
    const offenders: string[] = [];
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const spec of importsOf(file)) {
        if (spec.startsWith("@aws-sdk/")) offenders.push(`${file.slice(here.length + 1)} → ${spec}`);
        else if (spec.startsWith(".")) visit(resolve(dirname(file), spec.endsWith(".ts") ? spec : `${spec}.ts`));
      }
    };
    const tests = readdirSync(here).filter((f) => f.endsWith(".test.ts"));
    for (const entry of [...ROOT_ENTRIES, ...tests]) visit(resolve(here, entry));
    expect(offenders).toEqual([]);
  });
});
