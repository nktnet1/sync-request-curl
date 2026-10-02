import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

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
  // Sticky matching consumes the next parameter or fails immediately; it never
  // retries a long malformed key at each subsequent character. The quoted and
  // unquoted alternatives are disjoint, as are the quoted-string escape cases.
  const parameter =
    /[ \t]*([\w-]+)[ \t]*=[ \t]*(?:"((?:[^"\\\r\n]|\\[^\r\n])*)"|([^",\s]+))[ \t]*(?:,|$)/y;
  let offset = "Digest ".length;
  while (offset < authorization.length) {
    parameter.lastIndex = offset;
    const match = parameter.exec(authorization);
    if (!match || Object.hasOwn(fields, match[1].toLowerCase())) {
      return {};
    }
    fields[match[1].toLowerCase()] =
      match[2] === undefined
        ? match[3]
        : match[2].replace(/\\([^\r\n])/g, "$1");
    offset = parameter.lastIndex;
  }
  return fields;
};

const validCredentials = (req: IncomingMessage, scheme: string): boolean => {
  const authorization = req.headers.authorization ?? "";
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
    fields.uri !== req.url ||
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

/** Raw HTTP fixtures: no framework buffering or automatic HEAD conversion. */
export const handleRegressionRequest = (
  req: IncomingMessage,
  res: ServerResponse,
): boolean => {
  const url = new URL(req.url ?? "/", "http://fixture.invalid");
  if (!url.pathname.startsWith("/regressions/")) {
    return false;
  }
  if (url.pathname === "/regressions/auth") {
    const scheme = url.searchParams.get("scheme") ?? "basic";
    const authorized = validCredentials(req, scheme);
    const stale =
      authorized &&
      scheme === "digest" &&
      url.searchParams.has("stale") &&
      digestFields(req.headers.authorization ?? "").nonce === "first-nonce";
    const rejected = !authorized || stale || url.searchParams.has("reject");
    const nonce = stale ? "second-nonce" : "first-nonce";
    const headerDelay = Number(
      url.searchParams.get(rejected ? "challengeDelay" : "headersDelay") ?? 0,
    );
    req.resume();
    req.once("end", () =>
      later(res, headerDelay, () => {
        res.statusCode = rejected ? 401 : 200;
        if (rejected) {
          res.setHeader(
            "WWW-Authenticate",
            scheme === "digest"
              ? `Digest realm="${realm}", nonce="${nonce}", algorithm=MD5, qop="auth"${stale ? ", stale=true" : ""}`
              : `Basic realm="${realm}"`,
          );
        }
        const body = rejected ? "denied" : "authenticated";
        // Nonzero metadata length and keep-alive expose HEAD framing mistakes.
        res.setHeader("Content-Length", Buffer.byteLength(body));
        if (req.method === "HEAD") {
          res.removeHeader("Connection");
          res.end();
          return;
        }
        res.flushHeaders();
        later(res, Number(url.searchParams.get("bodyDelay") ?? 0), () =>
          res.end(body),
        );
      }),
    );
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
      res.end(JSON.stringify({ bytes }));
    });
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
