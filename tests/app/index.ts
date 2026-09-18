import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";

const app = new Hono();

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
  const body = await c.req.json();
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
  const body = await c.req.json();
  const value = body.value;
  if (value === "put") {
    throw new HTTPException(403, { message: "Cannot put 'put'!" });
  }
  return c.json({ value });
});

app.get("/redirect/source", (c) => {
  const redirectNumber = Number.parseInt(
    c.req.query("redirectNumber") ?? "0",
    10,
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
  return c.json({ apiKey: c.req.header("x-api-key") ?? null });
});

app.post("/content/length", async (c) => {
  const contentLength = Number.parseInt(
    c.req.header("content-length") ?? "0",
    10,
  );
  const buffer = await c.req.arrayBuffer();
  return c.json({
    headerLength: contentLength,
    serverBufferLength: buffer.byteLength,
  });
});

app.post("/timeout", async (c) => {
  const body = await c.req.json();
  const startTime = Date.now();
  while (Date.now() - startTime < body.timeout) {
    /* zzzZZ */
  }
  return c.json({});
});

app.post("/text", (c) => {
  return c.text("Hello world!");
});

app.get("/large/response", (c) => {
  return c.body("x".repeat(512 * 1024));
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
