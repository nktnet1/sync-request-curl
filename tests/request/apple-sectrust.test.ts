import { describe, expect, test } from "vitest";
import request from "#/index";
import { TLS_URL } from "#tests/app/config";

const runAppleSecTrustTest =
  process.platform === "darwin" && process.env.RUN_APPLE_SECTRUST_TEST === "1";

describe("Apple SecTrust", () => {
  test.runIf(runAppleSecTrustTest)(
    "trusts a macOS Keychain certificate without caFile",
    () => {
      expect(request("GET", TLS_URL).statusCode).toBe(200);
    },
  );
});
