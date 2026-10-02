import { readFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { connect } from "node:net";
import type { TLSSocket } from "node:tls";
import { HOST, PORT, SERVER_URL, TLS_PORT } from "#tests/app/config";

// Test-only self-signed certificate and key; never used outside local fixtures.
export const tlsServer = createHttpsServer(
  {
    key: readFileSync(new URL("./fixtures/tls-key.pem", import.meta.url)),
    cert: readFileSync(new URL("./fixtures/tls-cert.pem", import.meta.url)),
    ca: readFileSync(
      new URL("./fixtures/tls-client-ca-cert.pem", import.meta.url),
    ),
    requestCert: true,
    rejectUnauthorized: false,
  },
  (req, res) => {
    const socket = req.socket as TLSSocket;
    const peerCertificate = socket.getPeerCertificate();
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        address: req.socket.remoteAddress,
        proxyAuthorization: req.headers["proxy-authorization"] ?? null,
        proxyTrace: req.headers["x-proxy-trace"] ?? null,
        clientAuthorized: socket.authorized,
        clientSubject: peerCertificate.subject?.CN ?? null,
        tlsProtocol: socket.getProtocol(),
      }),
    );
  },
);

export const proxyServer = createServer((req, res) => {
  const target = new URL(req.url ?? "");
  if (target.origin !== SERVER_URL) {
    res.writeHead(403);
    res.end();
    return;
  }
  const headers = { ...req.headers };
  const proxyAuth = headers["proxy-authorization"] ?? null;
  const proxyTrace = headers["x-proxy-trace"] ?? null;
  const requireProxyAuth = headers["x-proxy-require-auth"];
  delete headers["proxy-authorization"];
  delete headers["x-proxy-trace"];
  delete headers["x-proxy-require-auth"];
  if (requireProxyAuth === "basic" && proxyAuth === null) {
    res.writeHead(407, { "Proxy-Authenticate": 'Basic realm="test-proxy"' });
    res.end();
    return;
  }
  const upstream = request(
    {
      hostname: HOST,
      port: PORT,
      path: `${target.pathname}${target.search}`,
      method: req.method,
      headers,
    },
    (incoming) => {
      res.setHeader("x-proxy-auth", String(proxyAuth));
      res.setHeader("x-proxy-trace", String(proxyTrace));
      res.writeHead(incoming.statusCode ?? 502);
      incoming.pipe(res);
    },
  );
  upstream.on("error", () => {
    res.writeHead(502);
    res.end();
  });
  req.pipe(upstream);
});
proxyServer.on("connect", (req, client, head) => {
  const target = new URL(`http://${req.url}`);
  if (target.hostname !== HOST || Number(target.port) !== TLS_PORT) {
    client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }
  const upstream = connect(TLS_PORT, HOST, () => {
    client.write("HTTP/1.1 200 Connection established\r\n\r\n");
    upstream.write(head);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  client.on("error", () => upstream.destroy());
  upstream.on("error", () => client.destroy());
  client.on("close", () => upstream.destroy());
});
