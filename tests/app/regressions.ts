import type { IncomingMessage, ServerResponse } from "node:http";
import { handleAuthRequest } from "#tests/app/regression-auth";
import { handleCacheRequest } from "#tests/app/regression-cache";
import {
  later,
  type RegressionHandler,
  responseBodyDelay,
  sendResponseBody,
} from "#tests/app/regression-utils";

export { digestFields } from "#tests/app/regression-auth";

const handleDelayedHeaders: RegressionHandler = (req, res) => {
  req.resume();
  later(res, 900, () => res.end("ready"));
};

const handleUploadRequest: RegressionHandler = (req, res, url) => {
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
};

const handleHeaderEcho: RegressionHandler = (req, res) => {
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
};

const handleDownloadRequest: RegressionHandler = (_req, res) => {
  res.end(Buffer.alloc(128 * 1024, "x"));
};

const handleStalledDownload: RegressionHandler = (_req, res, url) => {
  res.setHeader("Content-Length", 128 * 1024);
  res.flushHeaders();
  if (!url.searchParams.has("headersOnly")) {
    res.write(Buffer.alloc(32 * 1024, "x"));
  }
  later(res, 3_000, () => res.destroy());
};

const regressionHandlers = new Map<string, RegressionHandler>([
  ["/regressions/auth", handleAuthRequest],
  ["/regressions/delayed-headers", handleDelayedHeaders],
  ["/regressions/rate/upload", handleUploadRequest],
  ["/regressions/header-echo", handleHeaderEcho],
  ["/regressions/rate/download", handleDownloadRequest],
  ["/regressions/rate/stall", handleStalledDownload],
]);

/** Raw HTTP fixtures: no framework buffering or automatic HEAD conversion. */
export const handleRegressionRequest = (
  req: IncomingMessage,
  res: ServerResponse,
): boolean => {
  // Only the path and query are used; this base never opens a connection.
  const url = new URL(req.url ?? "/", "https://fixture.invalid");
  if (!url.pathname.startsWith("/regressions/")) return false;
  if (url.pathname.startsWith("/regressions/cache/")) {
    handleCacheRequest(req, res, url);
    return true;
  }
  const handler = regressionHandlers.get(url.pathname);
  if (handler) {
    handler(req, res, url);
  } else {
    res.statusCode = 404;
    res.end();
  }
  return true;
};
