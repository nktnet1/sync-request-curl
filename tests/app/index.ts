import { setTimeout as delay } from "node:timers/promises";
import { deflateSync, gzipSync } from "node:zlib";
import type { HttpBindings } from "@hono/node-server";
import { type Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { streamText } from "hono/streaming";
import * as v from "valibot";

const app = new Hono<{ Bindings: HttpBindings }>();
const connectionIds = new WeakMap<object, number>();
let nextConnectionId = 1;
const cacheOriginHits = new Map<string, number>();
const cacheVersions = new Map<string, number>();
const nextCacheOriginHit = (name: string, key: string): number => {
  const mapKey = `${name}:${key}`;
  const next = (cacheOriginHits.get(mapKey) ?? 0) + 1;
  cacheOriginHits.set(mapKey, next);
  return next;
};
const conditionalCacheResponse = (
  c: Context<{ Bindings: HttpBindings }>,
  name: string,
  key: string,
  maxAge: number,
  requestHeader: string,
  validatorHeader: string,
  validatorValue: string,
) => {
  const hits = nextCacheOriginHit(name, key);
  const headers: Record<string, string> = {
    "cache-control": `max-age=${maxAge}`,
    [validatorHeader]: validatorValue,
    "x-origin-hits": String(hits),
  };

  if (c.req.header(requestHeader) === validatorValue) {
    return new Response(null, { status: 304, headers });
  }

  for (const [headerName, value] of Object.entries(headers)) {
    c.header(headerName, value);
  }
  return c.json({ hits });
};

const toArrayBuffer = (buffer: Buffer): ArrayBuffer => {
  const arrayBuffer = new ArrayBuffer(buffer.length);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
};
const valueBodySchema = v.object({ value: v.optional(v.unknown()) });
const decimalIntegerSchema = v.pipe(
  v.string(),
  v.regex(/^\d+$/),
  v.transform(Number),
  v.number(),
  v.integer(),
);
const timeoutBodySchema = v.object({
  timeout: v.pipe(v.number(), v.finite(), v.minValue(0)),
});
const abortErrorSchema = v.object({ name: v.literal("AbortError") });

app.use("*", logger());

app.get("/", (c) => {
  return c.json({ message: "Hello, world!" });
});

app.get("/connection/id", (c) => {
  const socket = c.env.incoming.socket;
  let connectionId = connectionIds.get(socket);
  if (connectionId === undefined) {
    connectionId = nextConnectionId;
    nextConnectionId += 1;
    connectionIds.set(socket, connectionId);
  }
  return c.json({ connectionId });
});

app.get("/get", (c) => {
  const value = c.req.query("value");
  if (value === "echo") {
    throw new HTTPException(400, { message: "Cannot echo 'echo'!" });
  }
  return c.json({ value });
});

app.delete("/delete", (c) => {
  const value = c.req.header("value");
  if (value === "header") {
    throw new HTTPException(401, { message: "Cannot header 'header'!" });
  }
  return c.json({ value });
});

app.post("/post", async (c) => {
  const body = v.parse(valueBodySchema, await c.req.json());
  const value = body.value;
  if (value === "post") {
    throw new HTTPException(400, { message: "Cannot post 'post'!" });
  }
  return c.json({ value });
});

app.post("/json/echo", async (c) => {
  return c.json(await c.req.json());
});

app.put("/put", async (c) => {
  const body = v.parse(valueBodySchema, await c.req.json());
  const value = body.value;
  if (value === "put") {
    throw new HTTPException(403, { message: "Cannot put 'put'!" });
  }
  return c.json({ value });
});

app.get("/redirect/source", (c) => {
  const redirectNumber = v.parse(
    decimalIntegerSchema,
    c.req.query("redirectNumber") ?? "0",
  );
  return redirectNumber > 0
    ? c.redirect(`/redirect/source?redirectNumber=${redirectNumber - 1}`, 302)
    : c.redirect("/redirect/destination", 302);
});

app.get("/redirect/destination", (c) => {
  return c.json({ message: "Redirect success!" });
});

app.get("/redirect/response-headers/source", (c) => {
  c.header("x-intermediate-response", "intermediate");
  return c.redirect("/redirect/response-headers/destination", 302);
});

app.get("/redirect/response-headers/destination", (c) => {
  c.header("x-final-response", "final");
  return c.json({ message: "Redirect headers success!" });
});

app.all("/redirect/method/302", (c) => {
  return c.redirect("/redirect/method/destination", 302);
});

app.all("/redirect/method/303", (c) => {
  return c.redirect("/redirect/method/destination", 303);
});

app.all("/redirect/method/307", (c) => {
  return c.redirect("/redirect/method/destination", 307);
});

app.all("/redirect/method/destination", (c) => {
  return c.json({ method: c.req.method });
});

app.get("/redirect/headers/same-origin", (c) => {
  return c.redirect("/redirect/headers/destination", 302);
});

app.get("/redirect/headers/cross-origin", (c) => {
  const destination = new URL(c.req.url);
  destination.hostname =
    destination.hostname === "localhost" ? "127.0.0.1" : "localhost";
  destination.pathname = "/redirect/headers/destination";
  destination.search = "";
  return c.redirect(destination.href, 302);
});

app.get("/redirect/headers/destination", (c) => {
  return c.json({
    apiKey: c.req.header("x-api-key") ?? null,
    traceId: c.req.header("x-trace-id") ?? null,
  });
});

app.post("/content/length", async (c) => {
  const contentLength = v.parse(
    decimalIntegerSchema,
    c.req.header("content-length") ?? "0",
  );
  const buffer = await c.req.arrayBuffer();
  return c.json({
    headerLength: contentLength,
    serverBufferLength: buffer.byteLength,
  });
});

app.all("/request/headers", async (c) => {
  await c.req.arrayBuffer();
  return c.json({
    contentType: c.req.header("content-type") ?? null,
    contentLength: c.req.header("content-length") ?? null,
    transferEncoding: c.req.header("transfer-encoding") ?? null,
  });
});

app.post("/timeout", async (c) => {
  const body = v.parse(timeoutBodySchema, await c.req.json());

  try {
    await delay(body.timeout, undefined, { signal: c.req.raw.signal });
  } catch (error) {
    if (!v.is(abortErrorSchema, error)) {
      throw error;
    }
  }

  return c.json({});
});

app.get("/socket-timeout/active", (c) =>
  streamText(c, async (stream) => {
    for (let index = 0; index < 6; index += 1) {
      await stream.write(String(index));
      if (index < 5) {
        await stream.sleep(75);
      }
    }
  }),
);

app.get("/socket-timeout/inactive", (c) =>
  streamText(c, async (stream) => {
    await stream.write("before");
    await stream.sleep(450);
    await stream.write("after");
  }),
);

app.post("/text", (c) => {
  return c.text("Hello world!");
});

app.get("/large/response", (c) => {
  return c.body("x".repeat(512 * 1024));
});

app.get("/cache/fresh", (c) => {
  const key = c.req.query("key") ?? "default";
  return conditionalCacheResponse(
    c,
    "fresh",
    key,
    3600,
    "if-none-match",
    "etag",
    `"fresh-${key}"`,
  );
});

app.get("/cache/no-store", (c) => {
  const key = c.req.query("key") ?? "default";
  const hits = nextCacheOriginHit("no-store", key);
  c.header("Cache-Control", "no-store");
  return c.json({ hits });
});

app.get("/cache/revalidate/etag", (c) => {
  const key = c.req.query("key") ?? "default";
  return conditionalCacheResponse(
    c,
    "etag",
    key,
    0,
    "if-none-match",
    "etag",
    '"cache-v1"',
  );
});

app.get("/cache/revalidate/last-modified", (c) => {
  const key = c.req.query("key") ?? "default";
  return conditionalCacheResponse(
    c,
    "last-modified",
    key,
    0,
    "if-modified-since",
    "last-modified",
    "Wed, 21 Oct 2015 07:28:00 GMT",
  );
});

app.get("/cache/vary", (c) => {
  const key = c.req.query("key") ?? "default";
  const hits = nextCacheOriginHit("vary", key);
  const variant = c.req.header("x-variant") ?? "none";
  c.header("Cache-Control", "max-age=3600");
  c.header("Vary", "X-Variant");
  return c.json({ hits, variant });
});

app.get("/cache/range", (c) => {
  const key = c.req.query("key") ?? "default";
  const hits = nextCacheOriginHit("range", key);
  const headers = {
    "cache-control": "max-age=3600",
    "x-origin-hits": String(hits),
  };

  if (c.req.header("range") === "bytes=0-0") {
    return new Response("a", {
      status: 206,
      headers: {
        ...headers,
        "content-range": "bytes 0-0/6",
      },
    });
  }

  for (const [name, value] of Object.entries(headers)) {
    c.header(name, value);
  }
  return c.text("abcdef");
});

app.get("/cache/redirect", (c) => {
  const key = c.req.query("key") ?? "default";
  const hits = nextCacheOriginHit("redirect", key);
  c.header("Cache-Control", "max-age=3600");
  return c.redirect(
    `/cache/redirect-target?key=${encodeURIComponent(key)}&sourceHits=${hits}`,
    302,
  );
});

app.get("/cache/redirect-target", (c) => {
  const key = c.req.query("key") ?? "default";
  const targetHits = nextCacheOriginHit("redirect-target", key);
  const sourceHits = Number(c.req.query("sourceHits") ?? "0");
  c.header("Cache-Control", "no-store");
  return c.json({ sourceHits, targetHits });
});

app.get("/cache/mutable", (c) => {
  const key = c.req.query("key") ?? "default";
  const hits = nextCacheOriginHit("mutable", key);
  const version = cacheVersions.get(key) ?? 0;
  c.header("Cache-Control", "max-age=3600");
  return c.json({ hits, version });
});

app.post("/cache/mutable", (c) => {
  const key = c.req.query("key") ?? "default";
  const version = (cacheVersions.get(key) ?? 0) + 1;
  cacheVersions.set(key, version);
  return c.json({ version });
});

app.get("/compressed/:encoding", (c) => {
  const encoding = c.req.param("encoding");
  const payload = JSON.stringify({
    acceptEncoding: c.req.header("accept-encoding") ?? null,
    message: "Compressed response",
  });
  const body = Buffer.from(payload);

  if (encoding === "gzip") {
    return new Response(toArrayBuffer(gzipSync(body)), {
      headers: {
        "content-encoding": "gzip",
        "content-type": "application/json",
      },
    });
  }

  if (encoding === "deflate") {
    return new Response(toArrayBuffer(deflateSync(body)), {
      headers: {
        "content-encoding": "deflate",
        "content-type": "application/json",
      },
    });
  }

  return c.json({ error: "Unsupported compression encoding" }, 400);
});

app.all("/compat/echo", async (c) => {
  const url = new URL(c.req.url);
  const body = Buffer.from(await c.req.arrayBuffer());

  return c.json({
    method: c.req.method,
    search: url.search,
    contentType: c.req.header("content-type") ?? null,
    customHeader: c.req.header("x-compat-value") ?? null,
    body: body.toString("utf8"),
    bodyHex: body.toString("hex"),
  });
});

app.all("/compat/head-payload", async (c) => {
  const chunks: Buffer[] = [];
  for await (const chunk of c.env.incoming) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks);

  return new Response(null, {
    headers: {
      "content-length": "1024",
      "x-request-body-hex": body.toString("hex"),
      "x-request-body-length": String(body.length),
      "x-request-content-type": c.req.header("content-type") ?? "",
    },
  });
});

app.post("/upload", async (c) => {
  const body = await c.req.parseBody();
  const returnedBody = Object.entries(body)
    .map(([name, fileContent]) =>
      typeof fileContent === "string"
        ? { name, content: fileContent }
        : {
            name,
            file: {
              name: fileContent.name,
              size: fileContent.size,
              type: fileContent.type,
              lastModified: fileContent.lastModified,
            },
          },
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  return c.json(returnedBody);
});

app.onError((err, c) => {
  const status = err instanceof HTTPException ? err.status : 500;
  const message =
    err instanceof HTTPException ? err.message : "Internal Server Error";
  return c.json({ error: message }, status);
});

export default app;
