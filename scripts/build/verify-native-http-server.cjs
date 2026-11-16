const { createServer } = require("node:http");
const { parentPort } = require("node:worker_threads");

const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: true }));
});

server.listen(0, "127.0.0.1", () => {
  parentPort.postMessage(server.address().port);
});
