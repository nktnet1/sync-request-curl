import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  later,
  responseBodyDelay,
  sendResponseBody,
} from "#tests/app/regression-utils";

const realm = "transport-regression";
const basic = `Basic ${Buffer.from("user:secret").toString("base64")}`;
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
  const expectedFields = {
    username: "user",
    realm,
    uri: requestUri,
    qop: "auth",
  };
  const validFields = Object.entries(expectedFields).every(
    ([name, expected]) => fields[name] === expected,
  );
  if (
    !authorization.startsWith("Digest ") ||
    !validFields ||
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

interface AuthChallenge {
  statusCode: number;
  header: string;
  value: string;
}

const sendAuthResponse = (
  req: IncomingMessage,
  res: ServerResponse,
  params: URLSearchParams,
  authorization: string,
  challenge: AuthChallenge | undefined,
): void => {
  res.statusCode = challenge?.statusCode ?? 200;
  if (challenge) res.setHeader(challenge.header, challenge.value);
  sendResponseBody(
    req,
    res,
    challenge ? "denied" : "authenticated",
    responseBodyDelay(params, authorization === ""),
  );
};

const evaluateAuth = (
  req: IncomingMessage,
  url: URL,
  scheme: string,
  proxy: boolean,
  authorization: string,
): { rejected: boolean; challenge?: AuthChallenge } => {
  const params = url.searchParams;
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
  const challenge = rejected
    ? {
        statusCode: proxy ? 407 : 401,
        header: proxy ? "Proxy-Authenticate" : "WWW-Authenticate",
        value: createAuthChallenge(
          scheme,
          stale ? "second-nonce" : "first-nonce",
          stale,
        ),
      }
    : undefined;
  return { rejected, challenge };
};

export const handleAuthRequest = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): void => {
  const params = url.searchParams;
  const proxy = params.get("target") === "proxy";
  const authorization =
    req.headers[proxy ? "proxy-authorization" : "authorization"] ?? "";
  const scheme = params.get("scheme") ?? "basic";
  const { rejected, challenge } = evaluateAuth(
    req,
    url,
    scheme,
    proxy,
    authorization,
  );
  const headerDelay = Number(
    params.get(rejected ? "challengeDelay" : "headersDelay") ?? 0,
  );
  req.resume();
  req.once("end", () =>
    later(res, headerDelay, () =>
      sendAuthResponse(req, res, params, authorization, challenge),
    ),
  );
};
