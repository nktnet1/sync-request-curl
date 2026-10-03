import { test } from "vitest";
import { authenticationAssertions, authenticationTypes } from "./helpers";

const proxy = authenticationAssertions("proxy");

test.each(authenticationTypes)(
  "proxy authentication response bodies: cancels while draining a %s challenge, not after the body arrives",
  proxy.challengeDrainDeadline,
);

test(
  "proxy authentication response bodies: cancels while draining a stale Digest nonce challenge",
  proxy.staleDigestDrainDeadline,
);
