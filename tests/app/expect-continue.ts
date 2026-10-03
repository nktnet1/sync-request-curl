import { createServer } from "node:net";

// Node's HTTP server closes rejected Expect requests or drains their advertised
// body. A raw fixture can keep the connection open and accept curl's retry
// without mistaking its new request line for the rejected upload's body.
export const expectContinueServer = createServer((socket) => {
  let headerBytes = Buffer.alloc(0);
  let contentLength: number | undefined;
  let receivedBytes = 0;
  let expectation: string | null = null;
  socket.on("error", () => socket.destroy());
  socket.on("data", (data) => {
    const chunk = typeof data === "string" ? Buffer.from(data, "latin1") : data;
    if (contentLength === undefined) {
      headerBytes = Buffer.concat([headerBytes, chunk]);
      const headerEnd = headerBytes.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const headers = headerBytes.subarray(0, headerEnd).toString("latin1");
      const remaining = headerBytes.length - headerEnd - 4;
      headerBytes = Buffer.alloc(0);
      expectation = /^Expect:[ \t]*(.*)$/im.exec(headers)?.[1].trim() ?? null;
      if (expectation?.toLowerCase() === "100-continue") {
        socket.write(
          "HTTP/1.1 417 Expectation Failed\r\nContent-Length: 0\r\nX-Rejected-Expectation: yes\r\n\r\n",
        );
        return;
      }
      contentLength = Number(
        /^Content-Length:[ \t]*(\d+)$/im.exec(headers)?.[1] ?? 0,
      );
      receivedBytes = remaining;
    } else {
      receivedBytes += chunk.length;
    }
    if (receivedBytes < contentLength) return;
    const body = JSON.stringify({ bytes: receivedBytes, expect: expectation });
    socket.end(
      `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
    );
  });
});
