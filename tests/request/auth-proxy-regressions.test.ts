import { describe } from "vitest";
import { registerAuthenticationResponseBodyTests } from "./auth-regressions.helpers";

describe("proxy authentication response bodies", () => {
  registerAuthenticationResponseBodyTests("proxy");
});
