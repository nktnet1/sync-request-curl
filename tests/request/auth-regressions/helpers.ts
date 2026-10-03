import { expect } from "vitest";
import request from "#/index";
import type { Options } from "#/types/definition";
import { FRAMING_SERVER_URL } from "#tests/app/config";

export const credentials = {
  username: "user",
  password: "secret",
  type: "any",
} as const;

export const authEndpoint = `${FRAMING_SERVER_URL}/regressions/auth`;

export const authenticationTypes = ["any", "digest"] as const;

export type AuthenticationTarget = "origin" | "proxy";
export type NegotiatedAuthenticationType = (typeof authenticationTypes)[number];

export const expectHeaderDeadline = (url: string, options: Options): void => {
  const started = performance.now();
  expect(() =>
    request("GET", url, {
      ...options,
      timeout: 200,
      overallTimeout: 3_000,
    }),
  ).toThrow(expect.objectContaining({ code: 28 }));
  // An eventual timeout after draining the 1.5-second fixture body is a bug.
  // The generous scheduling margin avoids demanding millisecond precision.
  expect(performance.now() - started).toBeLessThan(1_000);
};

export const negotiatedOptions = (
  target: AuthenticationTarget,
  type: NegotiatedAuthenticationType,
  password = "secret",
): Options => {
  if (target === "proxy") {
    return {
      proxy: {
        url: FRAMING_SERVER_URL,
        username: "user",
        password,
        auth: type,
      },
    };
  }
  return { auth: { ...credentials, type, password } };
};

export const expectChallengeDrainDeadline = (
  target: AuthenticationTarget,
  type: NegotiatedAuthenticationType,
): void => {
  const scheme = type === "digest" ? "digest" : "basic";
  expectHeaderDeadline(
    `${authEndpoint}?target=${target}&scheme=${scheme}&bodyDelay=1500`,
    negotiatedOptions(target, type),
  );
};

export const expectStaleDigestDrainDeadline = (
  target: AuthenticationTarget,
): void => {
  expectHeaderDeadline(
    `${authEndpoint}?target=${target}&scheme=digest&stale=1&initialBodyDelay=0&bodyDelay=1500`,
    negotiatedOptions(target, "digest"),
  );
};

export const expectTerminalAuthenticationBodies = (
  target: AuthenticationTarget,
  type: NegotiatedAuthenticationType,
): void => {
  for (const password of ["secret", "wrong"]) {
    const scheme = type === "digest" ? "digest" : "basic";
    const response = request(
      "GET",
      `${authEndpoint}?target=${target}&scheme=${scheme}&initialBodyDelay=0&bodyDelay=450`,
      {
        ...negotiatedOptions(target, type, password),
        timeout: 250,
        overallTimeout: 2_000,
      },
    );
    const rejectionStatus = target === "proxy" ? 407 : 401;
    expect(response.statusCode).toBe(
      password === "secret" ? 200 : rejectionStatus,
    );
    expect(response.body.toString()).toBe(
      password === "secret" ? "authenticated" : "denied",
    );
  }
};
