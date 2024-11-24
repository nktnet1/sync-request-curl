import express, { json, Request, Response } from 'express';
import errorHandler from './errorHandler';
import createHttpError from 'http-errors';
import morgan from 'morgan';
import bodyParser from 'body-parser';

const app = express();

app.disable('x-powered-by');
app.use(morgan('dev'));
app.use(bodyParser.raw({
  type: 'application/timestamp-query'
}));
app.use(json());

app.get('/', (_: Request, res: Response) => { res.json({ message: 'Hello, world!' }); });

app.get('/get', (req: Request, res: Response) => {
  const value = req.query.value;
  if (value === 'echo') throw new createHttpError.BadRequest("Cannot echo 'echo'!");
  res.json({ value });
});

app.delete('/delete', (req: Request, res: Response) => {
  const value = req.headers.value;
  if (value === 'header') throw new createHttpError.Unauthorized("Cannot header 'header'!");
  res.json({ value });
});

app.post('/post', (req: Request, res: Response) => {
  const value = req.body.value;
  if (value === 'post') throw new createHttpError.BadRequest("Cannot post 'post'!");
  res.json({ value });
});

app.put('/put', (req: Request, res: Response) => {
  const value = req.body.value;
  if (value === 'put') throw new createHttpError.Forbidden("Cannot put 'put'!");
  res.json({ value });
});

app.get('/redirect/source', (req: Request, res: Response) => {
  const redirectNumber = parseInt(req.query.redirectNumber as string);
  return redirectNumber > 0
    ? res.redirect(302, `/redirect/source?redirectNumber=${redirectNumber - 1}`)
    : res.redirect(302, '/redirect/destination');
});

app.get('/redirect/destination', (_: Request, res: Response) => {
  res.status(200).json({ message: 'Redirect success!' });
});

app.post('/content/length', (req: Request, res: Response) => {
  res.status(200).json({
    headerLength: parseInt(req.headers['content-length'] as string),
    // See bodyparser middleware options above.
    serverBufferLength: req.body.length
  });
});

app.post('/timeout', (req: Request, res: Response) => {
  const startTime = new Date().getTime();
  while (new Date().getTime() - startTime < req.body.timeout) { /* zzzZZ */ }
  res.status(200).json({});
});

app.use(errorHandler());

export default app;
