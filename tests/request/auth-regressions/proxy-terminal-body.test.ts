import { test } from "vitest";
import { authenticationAssertions, authenticationTypes } from "./helpers";

const proxy = authenticationAssertions("proxy");

test.each(authenticationTypes)(
  "proxy authentication terminal response bodies: preserves slow terminal response bodies after %s negotiation",
  proxy.terminalBodies,
);
