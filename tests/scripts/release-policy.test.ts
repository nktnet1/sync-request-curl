import { expect, test } from "vitest";
import {
  getNativePackageName,
  supportedPlatformKeys,
} from "#/native/platform-key-core";
import {
  parseReleaseVersion,
  planRelease,
  releaseLabel,
  versionFromReleaseTag,
} from "#scripts/release-policy";

const version = "5.0.0-beta.2";
const fixture = () => {
  const names = supportedPlatformKeys.map(getNativePackageName);
  return [...names, "sync-request-curl"].map((name) => ({
    file: `${name.replaceAll("/", "-")}.tgz`,
    manifest: {
      name,
      version,
      optionalDependencies: Object.fromEntries(
        names.map((native) => [native, version]),
      ),
    },
  }));
};

test.each([
  ["5.0.0", "latest"],
  ["5.0.0-beta.0", "beta"],
  ["5.0.0-beta.12", "beta"],
])("maps %s to %s", (version, tag) => {
  expect(parseReleaseVersion(version).distTag).toBe(tag);
  expect(releaseLabel(version)).toBe(`v${version}`);
  expect(versionFromReleaseTag(`v${version}`)).toBe(version);
});
test.each([
  "5.0.0-rc.1",
  "5.0.0-beta.01",
  "05.0.0",
  "5x0x0",
  "5.0.0+build",
  "5.0.0\n",
  "5.0.0-beta.1.extra",
])("rejects unsupported release %s", (version) => {
  expect(() => parseReleaseVersion(version)).toThrow();
});
test("requires the v prefix", () => {
  expect(() => versionFromReleaseTag(version)).toThrow();
});
test("orders all native packages before the main package", () => {
  const artifacts = fixture();
  expect(planRelease([...artifacts].reverse(), version)).toEqual(artifacts);
});
test.each(["missing", "duplicate", "unexpected", "version", "dependency"])(
  "rejects an invalid release: %s",
  (mode) => {
    const artifacts = fixture();
    if (mode === "missing") artifacts.pop();
    if (mode === "duplicate") artifacts[0] = artifacts[1];
    if (mode === "unexpected") artifacts[0].manifest.name = "unrelated-package";
    if (mode === "version") artifacts[0].manifest.version = "5.0.0";
    if (mode === "dependency")
      artifacts[artifacts.length - 1].manifest.optionalDependencies = {};
    expect(() => planRelease(artifacts, version)).toThrow();
  },
);
