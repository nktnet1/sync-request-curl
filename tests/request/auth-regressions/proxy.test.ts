import { describe, test } from "vitest";
import {
  authenticationTypes,
  expectChallengeDrainDeadline,
  expectStaleDigestDrainDeadline,
} from "./helpers";

describe("proxy authentication response bodies", () => {
  test.each(authenticationTypes)(
    "cancels while draining a %s challenge, not after the body arrives",
    (type) => {
      expectChallengeDrainDeadline("proxy", type);
    },
  );

  test("cancels while draining a stale Digest nonce challenge", () => {
    expectStaleDigestDrainDeadline("proxy");
  });
});
