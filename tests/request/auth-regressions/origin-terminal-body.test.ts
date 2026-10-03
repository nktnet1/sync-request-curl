import { test } from "vitest";
import { authenticationAssertions, authenticationTypes } from "./helpers";

const origin = authenticationAssertions("origin");

test.each(authenticationTypes)(
  "origin authentication terminal response bodies: preserves slow terminal response bodies after %s negotiation",
  origin.terminalBodies,
);
