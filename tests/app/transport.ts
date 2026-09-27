import { readFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { connect } from "node:net";
import { HOST, PORT, SERVER_URL, TLS_PORT } from "#tests/app/config";

// Test-only self-signed certificate and key; never used outside local fixtures.
export const tlsServer = createHttpsServer(
  {
    key: readFileSync(new URL("./fixtures/tls-key.pem", import.meta.url)),
    cert: readFileSync(new URL("./fixtures/tls-cert.pem", import.meta.url)),
  },
  (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        address: req.socket.remoteAddress,
        proxyAuthorization: req.headers["proxy-authorization"] ?? null,
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
  delete headers["proxy-authorization"];
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
