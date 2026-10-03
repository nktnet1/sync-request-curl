import { describe } from "vitest";
import { registerAuthenticationResponseBodyTests } from "./auth-regressions.helpers";

describe("origin authentication response bodies", () => {
  registerAuthenticationResponseBodyTests("origin");
});
