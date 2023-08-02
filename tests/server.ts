import express, { json, Request, Response } from 'express';
import { HOST, PORT, SERVER_URL } from './config';

const app = express();

app.use(json());

app.get('/', (req: Request, res: Response) => {
  res.json({ message: 'Welcome to /' });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Express Server started and awaiting requests at the URL: '${SERVER_URL}'`);
});

process.on('SIGINT', () => {
  server.close(() => {
    console.log('Shutting down server gracefully.');
    process.exit();
  });
});
