import type { IncomingMessage, ServerResponse } from "node:http";

export const later = (
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

export const responseBodyDelay = (
  params: URLSearchParams,
  initial: boolean,
): number =>
  Number(
    (initial ? params.get("initialBodyDelay") : null) ??
      params.get("bodyDelay") ??
      0,
  );

export const sendResponseBody = (
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

export type RegressionHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
) => void;
