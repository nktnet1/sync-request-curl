import { createServer, maxHeaderSize } from "node:http";
import { serve } from "@hono/node-server";
import {
  FRAMING_PORT,
  FRAMING_SERVER_URL,
  HOST,
  PORT,
  PROXY_PORT,
  SERVER_URL,
  TLS_PORT,
} from "#tests/app/config";
import app from "#tests/app/index";
import { handleRegressionRequest } from "#tests/app/regressions";
import { proxyServer, tlsServer } from "#tests/app/transport";

let listeningServers = 0;
const markServerReady = (): void => {
  listeningServers += 1;
  if (listeningServers === 4) {
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
  if (handleRegressionRequest(request, response)) {
    return;
  }

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
    case "/trailers":
      response.setHeader("Trailer", "X-Checksum");
      response.write("hello");
      response.addTrailers({ "X-Checksum": "abc123" });
      response.end();
      return;
    case "/redirect/hanging-body": {
      response.statusCode = 302;
      response.setHeader("Location", "/redirect/target");
      response.flushHeaders();
      setTimeout(() => response.destroy(), 1_000).unref();
      return;
    }
    case "/redirect/target":
      response.end("redirected");
      return;
    case "/obs-text": {
      const rawResponse = Buffer.concat([
        Buffer.from("HTTP/1.1 200 OK\r\nX-Obs-Text: caf", "ascii"),
        Buffer.from([0xe9, 0x80, 0xff]),
        Buffer.from(
          "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
          "ascii",
        ),
      ]);
      request.socket.end(rawResponse);
      return;
    }
    case "/headers/invalid-name":
      request.socket.end(
        "HTTP/1.1 200 OK\r\nBad Header: value\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
      );
      return;
    case "/headers/invalid-value":
      request.socket.end(
        Buffer.concat([
          Buffer.from("HTTP/1.1 200 OK\r\nX-Test: bad", "ascii"),
          Buffer.from([0x01]),
          Buffer.from(
            "value\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            "ascii",
          ),
        ]),
      );
      return;
    case "/headers/obs-fold":
      request.socket.end(
        "HTTP/1.1 200 OK\r\nX-Test: first\r\n second\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
      );
      return;
    case "/headers/oversized":
      request.socket.end(
        `HTTP/1.1 200 OK\r\nX-Large: ${"x".repeat(maxHeaderSize)}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
      );
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

tlsServer.listen(TLS_PORT, HOST, markServerReady);
proxyServer.listen(PROXY_PORT, HOST, markServerReady);

const shutdown = (): void => {
  tlsServer.close();
  proxyServer.close();
  server.close();
  framingServer.close(() => {
    console.log("Shutting down test servers gracefully.");
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
