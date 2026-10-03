import { test } from "vitest";
import { authenticationAssertions, authenticationTypes } from "./helpers";

const origin = authenticationAssertions("origin");

test.each(authenticationTypes)(
  "origin authentication response bodies: cancels while draining a %s challenge, not after the body arrives",
  origin.challengeDrainDeadline,
);

test(
  "origin authentication response bodies: cancels while draining a stale Digest nonce challenge",
  origin.staleDigestDrainDeadline,
);
