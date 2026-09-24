import { serve } from "@hono/node-server";
import app from ".";
import { HOST, PORT, SERVER_URL } from "./config";

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
    process.send?.("sync-request-curl:test-server-ready");
  },
);

const shutdown = (): void => {
  server.close(() => {
    console.log("Shutting down server gracefully.");
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
