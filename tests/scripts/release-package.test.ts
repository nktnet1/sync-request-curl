import { describe, expect, it } from "vitest";
import { supportedPlatformKeys } from "#/native/platform-key-core";
import {
  createNativePackageManifest,
  type ReleasePackageJson,
} from "#scripts/release-package";

const packageJson: ReleasePackageJson = {
  name: "sync-request-curl",
  version: "5.0.0-beta.4",
};

describe("createNativePackageManifest", () => {
  it("marks FreeBSD arm64 as a platform-specific optional package", () => {
    const manifest = createNativePackageManifest(packageJson, "freebsd-arm64");

    expect(manifest).toMatchObject({
      name: "@nktnet/sync-request-curl-freebsd-arm64",
      os: ["freebsd"],
      cpu: ["arm64"],
      main: "./sync_request_curl_native.node",
    });
    expect(manifest).not.toHaveProperty("libc");
  });

  it.each(supportedPlatformKeys)(
    "adds searchable native package keywords for %s",
    (platform) => {
      const manifest = createNativePackageManifest(packageJson, platform);

      expect(manifest.keywords).toEqual([
        "sync-request",
        "sync-request-curl",
        "binary",
        "native",
        ...platform.split("-"),
      ]);
    },
  );
});
