import { describe, expect, test } from "vitest";
import { CurlError } from "#/errors";
import request from "#/index";
import { FRAMING_SERVER_URL, PROXY_URL } from "#tests/app/config";
import { authEndpoint, credentials } from "./auth-regressions.helpers";

describe("authentication response-header deadlines", () => {
  test.each(["secret", "wrong"])(
    "verifies negotiated Digest credentials (password=%s)",
    (password) => {
      const response = request("GET", `${authEndpoint}?scheme=digest`, {
        auth: { ...credentials, type: "digest", password },
        timeout: 1_000,
        overallTimeout: 2_000,
      });
      const authenticated = password === "secret";
      expect(response.statusCode).toBe(authenticated ? 200 : 401);
      expect(response.body.toString()).toBe(
        authenticated ? "authenticated" : "denied",
      );
    },
  );

  test("completes Digest stale-nonce retries within the deadline", () => {
    const response = request("GET", `${authEndpoint}?scheme=digest&stale=1`, {
      auth: { ...credentials, type: "digest" },
      timeout: 1_000,
      overallTimeout: 2_000,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body.toString()).toBe("authenticated");
  });

  test.each(["any", "digest"] as const)(
    "keeps timeout active after %s challenges",
    (type) => {
      let failure: unknown;
      try {
        request(
          "GET",
          `${authEndpoint}?scheme=${type === "digest" ? "digest" : "basic"}&headersDelay=900`,
          {
            auth: { ...credentials, type },
            timeout: 250,
            overallTimeout: 2_000,
          },
        );
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(CurlError);
      expect(failure).toMatchObject({ code: 28 });
    },
  );

  test("reuses one deadline across Digest stale-nonce retries", () => {
    expect(() =>
      request(
        "GET",
        `${authEndpoint}?scheme=digest&stale=1&challengeDelay=180&headersDelay=180`,
        {
          auth: { ...credentials, type: "digest" },
          timeout: 400,
          overallTimeout: 2_000,
        },
      ),
    ).toThrow(expect.objectContaining({ code: 28 }));
  });

  test("rearms the deadline after a proxy challenge", () => {
    expect(() =>
      request("GET", `${FRAMING_SERVER_URL}/regressions/delayed-headers`, {
        proxy: {
          url: PROXY_URL,
          username: "user",
          password: "secret",
          auth: "any",
          headers: { "x-proxy-require-auth": "basic" },
        },
        timeout: 250,
        overallTimeout: 2_000,
      }),
    ).toThrow(expect.objectContaining({ code: 28 }));
  });

  test.each([false, true])(
    "does not apply header timeout to a terminal response body (rejected=%s)",
    (reject) => {
      const response = request(
        "GET",
        `${authEndpoint}?bodyDelay=450${reject ? "&reject=1" : ""}`,
        {
          // Preemptive Basic makes the rejected response unambiguously terminal.
          auth: { ...credentials, type: "basic" },
          timeout: 250,
          overallTimeout: 2_000,
        },
      );
      expect(response.statusCode).toBe(reject ? 401 : 200);
      expect(response.body.toString()).toBe(
        reject ? "denied" : "authenticated",
      );
    },
  );

  test("allows successful negotiated responses and preserves a failed authentication", () => {
    expect(
      request("GET", authEndpoint, { auth: credentials, timeout: 1_000 })
        .statusCode,
    ).toBe(200);
    const denied = request("GET", authEndpoint, {
      auth: { ...credentials, password: "wrong" },
      timeout: 1_000,
    });
    expect(denied.statusCode).toBe(401);
    expect(denied.body.toString()).toBe("denied");
  });
});
