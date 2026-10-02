import { afterEach, describe, expect, test, vi } from "vitest";
import { CurlError } from "#/errors";
import { FormData } from "#/form-data";
import { isSafeAuthUsername, isSafeBearerToken } from "#/http/auth";
import request from "#/index";
import native from "#/native/index";
import type { Options } from "#/types/definition";
import { FRAMING_SERVER_URL, PROXY_URL, SERVER_URL } from "#tests/app/config";

const credentials = {
  username: "user",
  password: "secret",
  type: "any",
} as const;
const endpoint = `${FRAMING_SERVER_URL}/regressions/auth`;
afterEach(() => vi.restoreAllMocks());

describe("authentication credential boundaries", () => {
  test.each(["\r", "\n", "\r\nX-Injected: yes", "\0", "\t", "\x1f", "\x7f"])(
    "rejects control characters before native I/O: %j",
    (control) => {
      const call = vi.spyOn(native, "request").mockImplementation(() => {
        throw new Error("Unexpected native I/O");
      });
      for (const options of [
        { auth: { bearer: `token${control}` } },
        { auth: { username: `user${control}`, type: "digest" } },
        {
          proxy: { url: PROXY_URL, username: `user${control}`, auth: "digest" },
        },
        {
          proxy: {
            url: PROXY_URL.replace(
              "://",
              `://user${encodeURIComponent(control)}:secret@`,
            ),
            auth: "digest",
          },
        },
      ] satisfies Options[]) {
        expect(() => request("GET", endpoint, options)).toThrow();
      }
      expect(call).not.toHaveBeenCalled();
    },
  );

  test.each([
    "",
    "=",
    "token space",
    "token:colon",
    "to=ken",
    "token\n",
    "token=\n",
    "token\r",
    "token\u0085",
  ])("rejects malformed bearer tokens %j", (token) => {
    expect(isSafeBearerToken(token)).toBe(false);
  });
  test.each(["token", "a.b_c-~+/==", "abc=", "abc==="])(
    "accepts RFC 6750 bearer syntax %j",
    (token) => {
      expect(isSafeBearerToken(token)).toBe(true);
    },
  );
  test("preserves empty/Unicode usernames and encoded password characters", () => {
    expect(isSafeAuthUsername("")).toBe(true);
    expect(isSafeAuthUsername("caf\u00e9")).toBe(true);
    const password = "secret\r\nwith-controls";
    const response = request("GET", `${SERVER_URL}/auth/echo`, {
      auth: { username: "user", password },
    });
    expect(response.getJSON()).toMatchObject({
      authorization: `Basic ${Buffer.from(`user:${password}`).toString("base64")}`,
    });
  });
});

describe("authentication response-header deadlines", () => {
  test.each(["any", "digest"] as const)(
    "keeps timeout active after %s challenges",
    (type) => {
      let failure: unknown;
      try {
        request(
          "GET",
          `${endpoint}?scheme=${type === "digest" ? "digest" : "basic"}&headersDelay=900`,
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
        `${endpoint}?scheme=digest&stale=1&challengeDelay=180&headersDelay=180`,
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
        `${endpoint}?bodyDelay=450${reject ? "&reject=1" : ""}`,
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
      request("GET", endpoint, { auth: credentials, timeout: 1_000 })
        .statusCode,
    ).toBe(200);
    const denied = request("GET", endpoint, {
      auth: { ...credentials, password: "wrong" },
      timeout: 1_000,
    });
    expect(denied.statusCode).toBe(401);
    expect(denied.body.toString()).toBe("denied");
  });
});

describe("HEAD authentication boundaries", () => {
  test.each(["any", "digest", "ntlm", "negotiate"] as const)(
    "rejects %s with raw, empty, JSON, and multipart payloads before I/O",
    (type) => {
      const form = new FormData();
      form.append("field", "value");
      const call = vi.spyOn(native, "request").mockImplementation(() => {
        throw new Error("Unexpected native I/O");
      });
      for (const payload of [
        { body: "abc" },
        { body: "" },
        { json: {} },
        { form },
      ]) {
        for (const auth of [
          { auth: { ...credentials, type } },
          { proxy: { url: PROXY_URL, username: "user", auth: type } },
        ]) {
          expect(() =>
            request("HEAD", endpoint, { ...payload, ...auth }),
          ).toThrow(
            "HEAD requests with a payload cannot use negotiated authentication",
          );
        }
      }
      expect(call).not.toHaveBeenCalled();
    },
  );

  test.each(["any", "digest"] as const)(
    "still negotiates %s for HEAD without a payload",
    (type) => {
      const response = request(
        "HEAD",
        `${endpoint}?scheme=${type === "digest" ? "digest" : "basic"}`,
        {
          auth: { ...credentials, type },
          timeout: 1_000,
          overallTimeout: 2_000,
        },
      );
      expect(response.statusCode).toBe(200);
      expect(response.body.length).toBe(0);
      expect(response.headers["content-length"]).not.toBe("0");
    },
  );

  test.each([{ username: "user", password: "secret" }, { bearer: "token" }])(
    "still sends HEAD payloads with preemptive authentication %j",
    (auth) => {
      const body = Buffer.from("HEAD payload");
      const response = request("HEAD", `${SERVER_URL}/compat/head-payload`, {
        body,
        auth,
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["x-request-body-hex"]).toBe(body.toString("hex"));
      expect(response.body.length).toBe(0);
    },
  );
});
