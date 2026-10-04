import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const realm = "transport-regression";
const basic = `Basic ${Buffer.from("user:secret").toString("base64")}`;
const cacheOriginHits = new Map<string, number>();
const cacheOriginVersions = new Map<string, number>();
// Test-only RFC 2617 interoperability: fixed, public dummy credentials, not
// password storage or a security boundary. Keep MD5 for legacy Digest clients
// (including Windows SSPI); do not replace it with an incompatible challenge.
const md5 = (value: string): string =>
  createHash("md5").update(value).digest("hex"); // NOSONAR: reviewed test-only legacy Digest computation.

export const digestFields = (authorization: string): Record<string, string> => {
  const fields: Record<string, string> = Object.create(null);
  if (!authorization.startsWith("Digest ")) {
    return fields;
  }
  // Parse names and values separately to keep both patterns small. Sticky
  // matching never skips malformed input. The value alternatives are disjoint,
  // as are the quoted-string escape cases, so long invalid inputs stay linear.
  const parameterName = /[ \t]*([\w-]+)[ \t]*=[ \t]*/y;
  const parameterValue =
    /(?:"((?:[^"\\\r\n]|\\[^\r\n])*)"|([^",\s]+))[ \t]*(?:,|$)/y;
  let offset = "Digest ".length;
  while (offset < authorization.length) {
    parameterName.lastIndex = offset;
    const name = parameterName.exec(authorization);
    if (!name) {
      return {};
    }
    const key = name[1].toLowerCase();
    if (Object.hasOwn(fields, key)) {
      return {};
    }
    parameterValue.lastIndex = parameterName.lastIndex;
    const value = parameterValue.exec(authorization);
    if (!value) {
      return {};
    }
    fields[key] =
      value[1] === undefined
        ? value[2]
        : value[1].replace(/\\([^\r\n])/g, "$1");
    offset = parameterValue.lastIndex;
  }
  return fields;
};

const createAuthChallenge = (
  scheme: string,
  nonce: string,
  stale: boolean,
): string => {
  if (scheme !== "digest") {
    return `Basic realm="${realm}"`;
  }
  const staleParameter = stale ? ", stale=true" : "";
  return `Digest realm="${realm}", nonce="${nonce}", algorithm=MD5, qop="auth"${staleParameter}`;
};

const validCredentials = (
  req: IncomingMessage,
  scheme: string,
  authorization: string,
  requestUri: string | undefined,
): boolean => {
  if (scheme === "bearer") {
    return authorization === "Bearer token";
  }
  if (scheme !== "digest") {
    return authorization === basic;
  }
  const fields = digestFields(authorization);
  if (
    !authorization.startsWith("Digest ") ||
    fields.username !== "user" ||
    fields.realm !== realm ||
    fields.uri !== requestUri ||
    fields.qop !== "auth" ||
    !["first-nonce", "second-nonce"].includes(fields.nonce ?? "")
  ) {
    return false;
  }
  const ha1 = md5(`user:${realm}:secret`);
  const ha2 = md5(`${req.method}:${fields.uri}`);
  return (
    fields.response ===
    md5(`${ha1}:${fields.nonce}:${fields.nc}:${fields.cnonce}:auth:${ha2}`)
  );
};

const later = (
  res: ServerResponse,
  delay: number,
  callback: () => void,
): void => {
  if (delay === 0) {
    callback();
    return;
  }
  const timer = setTimeout(callback, delay);
  timer.unref();
  res.once("close", () => clearTimeout(timer));
};

const responseBodyDelay = (params: URLSearchParams, initial: boolean): number =>
  Number(
    (initial ? params.get("initialBodyDelay") : null) ??
      params.get("bodyDelay") ??
      0,
  );

const sendResponseBody = (
  req: IncomingMessage,
  res: ServerResponse,
  body: string,
  delay: number,
): void => {
  // Nonzero metadata length and keep-alive expose HEAD framing mistakes.
  res.setHeader("Content-Length", Buffer.byteLength(body));
  if (req.method === "HEAD") {
    res.removeHeader("Connection");
    res.end();
    return;
  }
  res.flushHeaders();
  later(res, delay, () => res.end(body));
};

const handleAuthRequest = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): void => {
  const params = url.searchParams;
  const proxy = params.get("target") === "proxy";
  const authorization =
    req.headers[proxy ? "proxy-authorization" : "authorization"] ?? "";
  const scheme = params.get("scheme") ?? "basic";
  // libcurl hashes origin-form paths for proxy Digest, even though the HTTP
  // proxy request line itself uses an absolute-form target.
  const requestUri = proxy ? `${url.pathname}${url.search}` : req.url;
  const authorized = validCredentials(req, scheme, authorization, requestUri);
  const stale =
    authorized &&
    scheme === "digest" &&
    params.has("stale") &&
    digestFields(authorization).nonce === "first-nonce";
  const rejected = !authorized || stale || params.has("reject");
  const headerDelay = Number(
    params.get(rejected ? "challengeDelay" : "headersDelay") ?? 0,
  );
  req.resume();
  req.once("end", () =>
    later(res, headerDelay, () => {
      res.statusCode = 200;
      if (rejected) {
        res.statusCode = proxy ? 407 : 401;
        res.setHeader(
          proxy ? "Proxy-Authenticate" : "WWW-Authenticate",
          createAuthChallenge(
            scheme,
            stale ? "second-nonce" : "first-nonce",
            stale,
          ),
        );
      }
      sendResponseBody(
        req,
        res,
        rejected ? "denied" : "authenticated",
        responseBodyDelay(params, authorization === ""),
      );
    }),
  );
};

/** Raw HTTP fixtures: no framework buffering or automatic HEAD conversion. */
export const handleRegressionRequest = (
  req: IncomingMessage,
  res: ServerResponse,
): boolean => {
  // Only the path and query are used; this base never opens a connection.
  const url = new URL(req.url ?? "/", "https://fixture.invalid");
  if (!url.pathname.startsWith("/regressions/")) {
    return false;
  }
  if (url.pathname.startsWith("/regressions/cache/")) {
    // Use the raw request target so encoded dots remain distinct resources.
    const target = req.url ?? "/";
    const hits = (cacheOriginHits.get(target) ?? 0) + 1;
    cacheOriginHits.set(target, hits);
    const mutable = url.pathname === "/regressions/cache/mutable";
    const version =
      (cacheOriginVersions.get(target) ?? 0) +
      (mutable && req.method === "POST" ? 1 : 0);
    if (mutable) cacheOriginVersions.set(target, version);
    const etag = mutable ? `"cache-v${version}"` : '"cache-v1"';
    const lastModified = "Wed, 21 Oct 2015 07:28:00 GMT";
    res.setHeader("Content-Type", "application/json");
    res.setHeader("ETag", etag);
    res.setHeader("Last-Modified", lastModified);
    res.setHeader(
      "Cache-Control",
      url.pathname === "/regressions/cache/duplicate"
        ? ["max-age=0", "max-age=3600"]
        : "max-age=3600",
    );
    const ifMatch = req.headers["if-match"];
    const ifUnmodifiedSince = req.headers["if-unmodified-since"];
    if (
      (ifMatch !== undefined && ifMatch !== etag) ||
      (ifUnmodifiedSince !== undefined &&
        Date.parse(ifUnmodifiedSince) < Date.parse(lastModified))
    ) {
      res.statusCode = 412;
    }
    req.resume();
    const body = JSON.stringify({
      hits,
      target,
      ...(mutable ? { version } : {}),
    });
    res.setHeader("Content-Length", Buffer.byteLength(body));
    res.end(req.method === "HEAD" ? undefined : body);
    return true;
  }
  if (url.pathname === "/regressions/auth") {
    handleAuthRequest(req, res, url);
    return true;
  }
  if (url.pathname === "/regressions/delayed-headers") {
    req.resume();
    later(res, 900, () => res.end("ready"));
    return true;
  }
  if (url.pathname === "/regressions/rate/upload") {
    let bytes = 0;
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
    });
    req.once("end", () => {
      if (url.searchParams.has("stall")) {
        later(res, 3_000, () => res.destroy());
        return;
      }
      res.setHeader("Content-Type", "application/json");
      res.setHeader("X-Received-Bytes", bytes);
      sendResponseBody(
        req,
        res,
        JSON.stringify({ bytes }),
        responseBodyDelay(url.searchParams, bytes === 0),
      );
    });
    return true;
  }
  if (url.pathname === "/regressions/header-echo") {
    req.resume();
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        value: req.headers["x-test"] ?? null,
        cookie: req.headers.cookie ?? null,
        validator: req.headers["if-none-match"] ?? null,
        proxyTrace: req.headers["x-proxy-trace"] ?? null,
      }),
    );
    return true;
  }
  if (url.pathname === "/regressions/rate/download") {
    res.end(Buffer.alloc(128 * 1024, "x"));
    return true;
  }
  if (url.pathname === "/regressions/rate/stall") {
    res.setHeader("Content-Length", 128 * 1024);
    res.flushHeaders();
    if (!url.searchParams.has("headersOnly")) {
      res.write(Buffer.alloc(32 * 1024, "x"));
    }
    later(res, 3_000, () => res.destroy());
    return true;
  }
  res.statusCode = 404;
  res.end();
  return true;
};
