import { setTimeout as delay } from "node:timers/promises";
import { deflateSync, gzipSync } from "node:zlib";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { streamText } from "hono/streaming";
import * as v from "valibot";

const app = new Hono();
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

app.post("/request/headers", async (c) => {
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
