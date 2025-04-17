import { HOST, PORT, SERVER_URL } from './config';
import { serve } from '@hono/node-server';
import app from '.';

const server = serve({
  fetch: app.fetch,
  port: PORT,
  hostname: HOST, 
}, () => {
  console.log(`Hono Server started and awaiting requests at the URL: '${SERVER_URL}'`);
});

process.on('SIGINT', () => {
  server.close(() => {
    console.log('Shutting down server gracefully.');
  });
});
