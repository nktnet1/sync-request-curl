import { describe, test } from "vitest";
import {
  authenticationTypes,
  expectTerminalAuthenticationBodies,
} from "./helpers";

describe("origin authentication terminal response bodies", () => {
  test.each(authenticationTypes)(
    "preserves slow terminal response bodies after %s negotiation",
    (type) => {
      expectTerminalAuthenticationBodies("origin", type);
    },
  );
});
