import { readFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { connect } from "node:net";

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
  const headers = { ...req.headers };
  const proxyAuth = headers["proxy-authorization"] ?? null;
  delete headers["proxy-authorization"];
  const upstream = request(
    target,
    { method: req.method, headers },
    (incoming) => {
      res.writeHead(incoming.statusCode ?? 502, {
        ...incoming.headers,
        "x-proxy-auth": String(proxyAuth),
      });
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
  const upstream = connect(Number(target.port), target.hostname, () => {
    client.write("HTTP/1.1 200 Connection established\r\n\r\n");
    upstream.write(head);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  client.on("error", () => upstream.destroy());
  upstream.on("error", () => client.destroy());
  client.on("close", () => upstream.destroy());
});
