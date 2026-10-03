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

const expectHeaderDeadline = (url: string, options: Options): void => {
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

const negotiatedOptions = (
  target: "origin" | "proxy",
  type: "any" | "digest",
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

const authTargets = ["origin", "proxy"] as const;

describe.each(authTargets)("%s authentication response bodies", (target) => {
  test.each(["any", "digest"] as const)(
    "cancels while draining a %s challenge, not after the body arrives",
    (type) => {
      const scheme = type === "digest" ? "digest" : "basic";
      expectHeaderDeadline(
        `${endpoint}?target=${target}&scheme=${scheme}&bodyDelay=1500`,
        negotiatedOptions(target, type),
      );
    },
  );

  test("cancels while draining a stale Digest nonce challenge", () => {
    expectHeaderDeadline(
      `${endpoint}?target=${target}&scheme=digest&stale=1&initialBodyDelay=0&bodyDelay=1500`,
      negotiatedOptions(target, "digest"),
    );
  });

  test.each(["any", "digest"] as const)(
    "preserves slow terminal response bodies after %s negotiation",
    (type) => {
      for (const password of ["secret", "wrong"]) {
        const scheme = type === "digest" ? "digest" : "basic";
        const response = request(
          "GET",
          `${endpoint}?target=${target}&scheme=${scheme}&initialBodyDelay=0&bodyDelay=450`,
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
    },
  );
});

describe("authentication response-header deadlines", () => {
  test.each(["secret", "wrong"])(
    "verifies negotiated Digest credentials (password=%s)",
    (password) => {
      const response = request("GET", `${endpoint}?scheme=digest`, {
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
    const response = request("GET", `${endpoint}?scheme=digest&stale=1`, {
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

describe("successful Digest upload probes", () => {
  const upload = `${FRAMING_SERVER_URL}/regressions/rate/upload`;
  const auth = { ...credentials, type: "digest" } as const;

  test.each(["POST", "PUT", "GET"] as const)(
    "returns only the real %s upload response after an accepted empty probe",
    (method) => {
      for (const timeout of [0, 1_000]) {
        const response = request(method, upload, {
          body: "abc",
          auth,
          timeout,
          overallTimeout: 2_000,
        });
        expect(response.statusCode).toBe(200);
        expect(response.getJSON()).toStrictEqual({ bytes: 3 });
        expect(response.headers["x-received-bytes"]).toBe("3");
      }
    },
  );

  test("preserves binary, JSON, and multipart payloads", () => {
    const form = new FormData();
    form.append("field", "value");
    for (const payload of [
      { body: Buffer.from([0, 1, 255]) },
      { json: { value: true } },
      { form },
    ]) {
      const response = request("POST", upload, {
        ...payload,
        auth,
        timeout: 1_000,
        overallTimeout: 2_000,
      });
      expect(response.statusCode).toBe(200);
      const bytes = Number(response.headers["x-received-bytes"]);
      expect(bytes).toBeGreaterThan(0);
      expect(response.getJSON()).toStrictEqual({ bytes });
    }
  });

  test("keeps the deadline while draining an accepted probe", () => {
    expectHeaderDeadline(`${upload}?initialBodyDelay=1500`, {
      body: "abc",
      auth,
    });
  });

  test("does not time out the real upload response body", () => {
    const response = request(
      "POST",
      `${upload}?initialBodyDelay=0&bodyDelay=450`,
      {
        body: "abc",
        auth,
        timeout: 250,
        overallTimeout: 2_000,
      },
    );
    expect(response.statusCode).toBe(200);
    expect(response.getJSON()).toStrictEqual({ bytes: 3 });
  });
});
