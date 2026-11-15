import type { IncomingMessage } from "node:http";
import type { RegressionHandler } from "#tests/app/regression-utils";

const cacheOriginHits = new Map<string, number>();
const cacheOriginVersions = new Map<string, number>();

const nextCacheVersion = (target: string, increment: boolean): number => {
  const version = (cacheOriginVersions.get(target) ?? 0) + (increment ? 1 : 0);
  cacheOriginVersions.set(target, version);
  return version;
};

const failsCachePrecondition = (
  req: IncomingMessage,
  etag: string,
  lastModified: string,
): boolean => {
  const ifMatch = req.headers["if-match"];
  const ifUnmodifiedSince = req.headers["if-unmodified-since"];
  return (
    (ifMatch !== undefined && ifMatch !== etag) ||
    (ifUnmodifiedSince !== undefined &&
      Date.parse(ifUnmodifiedSince) < Date.parse(lastModified))
  );
};

export const handleCacheRequest: RegressionHandler = (req, res, url) => {
  // Use the raw request target so encoded dots remain distinct resources.
  const target = req.url ?? "/";
  const hits = (cacheOriginHits.get(target) ?? 0) + 1;
  cacheOriginHits.set(target, hits);
  const version =
    url.pathname === "/regressions/cache/mutable"
      ? nextCacheVersion(target, req.method === "POST")
      : undefined;
  const etag = version === undefined ? '"cache-v1"' : `"cache-v${version}"`;
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
  if (failsCachePrecondition(req, etag, lastModified)) res.statusCode = 412;
  req.resume();
  const body = JSON.stringify({
    hits,
    target,
    ...(version === undefined ? {} : { version }),
  });
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(req.method === "HEAD" ? undefined : body);
};
