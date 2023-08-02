import express, { json, Request, Response } from 'express';
import { HOST, PORT, SERVER_URL } from './config';
import errorHandler from './errorHandler';
import createHttpError from 'http-errors';

const app = express();

app.use(json());

app.get('/', (_: Request, res: Response) => res.json({ message: 'Hello, world!' }));

app.get('/echo', (req: Request, res: Response) => {
  const value = req.query.value;
  if (value === 'echo') {
    throw new createHttpError.BadRequest("Cannot echo 'echo'!");
  }
  res.json({ value });
});

app.get('/register', (req: Request, res: Response) => {
  const value = req.query.value;
  if (value === 'echo') {
    throw new createHttpError.BadRequest("Cannot echo 'echo'!");
  }
  res.json({ value });
});

app.use(errorHandler());

const server = app.listen(PORT, HOST, () => {
  console.log(`Express Server started and awaiting requests at the URL: '${SERVER_URL}'`);
});

process.on('SIGINT', () => {
  server.close(() => {
    console.log('Shutting down server gracefully.');
    process.exit();
  });
});
