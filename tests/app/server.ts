import { createServer } from "node:http";
import { serve } from "@hono/node-server";
import {
  FRAMING_PORT,
  FRAMING_SERVER_URL,
  HOST,
  PORT,
  SERVER_URL,
} from "#tests/app/config";
import app from "#tests/app/index";

let listeningServers = 0;
const markServerReady = (): void => {
  listeningServers += 1;
  if (listeningServers === 2) {
    process.send?.("sync-request-curl:test-server-ready");
  }
};

const server = serve(
  {
    fetch: app.fetch,
    port: PORT,
    hostname: HOST,
  },
  () => {
    console.log(
      `Hono Server started and awaiting requests at the URL: '${SERVER_URL}'`,
    );
    markServerReady();
  },
);

const framingServer = createServer((request, response) => {
  response.setHeader("Connection", "close");

  switch (request.url) {
    case "/content-length/identical":
      response.setHeader("Content-Length", ["5", "5"]);
      response.end("hello");
      return;
    case "/content-length/conflicting":
      response.setHeader("Content-Length", ["5", "6"]);
      response.end("hello!");
      return;
    case "/content-length/transfer-encoding":
      response.setHeader("Content-Length", "5");
      response.setHeader("Transfer-Encoding", "chunked");
      response.end("hello");
      return;
    default:
      response.statusCode = 404;
      response.end("Not found");
  }
});

framingServer.listen(FRAMING_PORT, HOST, () => {
  console.log(
    `Framing test server started and awaiting requests at the URL: '${FRAMING_SERVER_URL}'`,
  );
  markServerReady();
});

const shutdown = (): void => {
  server.close();
  framingServer.close(() => {
    console.log("Shutting down test servers gracefully.");
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
