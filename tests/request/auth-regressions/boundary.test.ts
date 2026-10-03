import { afterEach, describe, expect, test, vi } from "vitest";
import { FormData } from "#/form-data";
import { isSafeAuthUsername, isSafeBearerToken } from "#/http/auth";
import request from "#/index";
import native from "#/native/index";
import type { Options } from "#/types/definition";
import { FRAMING_SERVER_URL, PROXY_URL, SERVER_URL } from "#tests/app/config";
import { authEndpoint, credentials } from "./helpers";

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
        expect(() => request("GET", authEndpoint, options)).toThrow();
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

  test.each([undefined, "basic", "digest", "any"] as const)(
    "rejects ambiguous usernames and password controls for %s before native I/O",
    (type) => {
      const call = vi.spyOn(native, "request").mockImplementation(() => {
        throw new Error("Unexpected native I/O");
      });
      for (const options of [
        { auth: { username: "user:name", password: "secret", type } },
        { auth: { username: "user", password: "secret\n", type } },
        { proxy: { url: PROXY_URL, username: "user:name", auth: type } },
        {
          proxy: {
            url: PROXY_URL,
            username: "user",
            password: "secret\t",
            auth: type,
          },
        },
        {
          proxy: {
            url: PROXY_URL.replace("://", "://user%3Aname:secret@"),
            auth: type,
          },
        },
        {
          proxy: {
            url: PROXY_URL.replace("://", "://user:secret%0Avalue@"),
            auth: type,
          },
        },
      ] satisfies Options[]) {
        expect(() => request("GET", authEndpoint, options)).toThrow();
      }
      expect(call).not.toHaveBeenCalled();
    },
  );

  test("preserves empty/Unicode usernames and valid password punctuation", () => {
    expect(isSafeAuthUsername("")).toBe(true);
    expect(isSafeAuthUsername("caf\u00e9")).toBe(true);
    const password = "secret:with=punc";
    const response = request("GET", `${SERVER_URL}/auth/echo`, {
      auth: { username: "user", password },
    });
    expect(response.getJSON()).toMatchObject({
      authorization: `Basic ${Buffer.from(`user:${password}`).toString("base64")}`,
    });
  });
});

describe.each([
  { name: "default persistence", headers: {}, connection: "keep-alive" },
  {
    name: "explicit closure",
    headers: { Connection: "close" },
    connection: "close",
  },
])("authentication fixture connections: $name", ({ headers, connection }) => {
  test.each([
    {
      name: "origin challenge",
      path: "auth?scheme=digest",
      status: 401,
      body: "denied",
    },
    {
      name: "proxy challenge",
      path: "auth?target=proxy&scheme=digest",
      status: 407,
      body: "denied",
    },
    {
      name: "accepted upload probe",
      path: "rate/upload",
      status: 200,
      body: JSON.stringify({ bytes: 0 }),
    },
  ])("$name", ({ path, status, body }) => {
    const response = request(
      "GET",
      `${FRAMING_SERVER_URL}/regressions/${path}`,
      { headers, timeout: 1_000, overallTimeout: 2_000 },
    );
    expect(response.statusCode).toBe(status);
    expect(response.headers.connection).toBe(connection);
    expect(response.headers["content-length"]).toBe(
      String(Buffer.byteLength(body)),
    );
    expect(response.body.toString()).toBe(body);
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
            request("HEAD", authEndpoint, { ...payload, ...auth }),
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
        `${authEndpoint}?scheme=${type === "digest" ? "digest" : "basic"}`,
        {
          auth: { ...credentials, type },
          timeout: 1_000,
          overallTimeout: 2_000,
        },
      );
      expect(response.statusCode).toBe(200);
      expect(response.body).toHaveLength(0);
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
      expect(response.body).toHaveLength(0);
    },
  );
});
