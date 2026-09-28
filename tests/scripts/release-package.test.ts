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
  it.each(supportedPlatformKeys)(
    "adds searchable native package keywords for %s",
    (platform) => {
      const manifest = createNativePackageManifest(packageJson, platform);

      expect(manifest.keywords).toEqual([
        "sync-request-curl",
        "binary",
        "native",
        ...platform.split("-"),
      ]);
    },
  );
});
