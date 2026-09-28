import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { publishReleasePackages } from "#scripts/release-publisher";

const { values } = parseArgs({
  options: {
    registry: { type: "string" },
    tag: { type: "string" },
    "expected-sha": { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const registry = values.registry;
if (!registry) throw new Error("--registry is required");

publishReleasePackages({
  root: realpathSync(resolve(import.meta.dirname, "..")),
  registry,
  tag: values.tag,
  expectedSha: values["expected-sha"],
  dryRun: values["dry-run"],
});
