import express, { json, Request, Response } from 'express';
import errorHandler from './errorHandler';
import createHttpError from 'http-errors';
import morgan from 'morgan';

const app = express();

app.disable('x-powered-by');
app.use(json());
app.use(morgan('dev'));

app.get('/', (_: Request, res: Response) => res.json({ message: 'Hello, world!' }));

app.get('/echo', (req: Request, res: Response) => {
  const value = req.query.value;
  if (value === 'echo') throw new createHttpError.BadRequest("Cannot echo 'echo'!");
  res.json({ value });
});

app.delete('/heako', (req: Request, res: Response) => {
  const value = req.headers.value;
  if (value === 'heako') throw new createHttpError.Unauthorized("Cannot heako 'heako'!");
  res.json({ value });
});

app.post('/poeko', (req: Request, res: Response) => {
  const value = req.body.value;
  if (value === 'poeko') throw new createHttpError.BadRequest("Cannot poeko 'poeko'!");
  res.json({ value });
});

app.put('/pueko', (req: Request, res: Response) => {
  const value = req.body.value;
  if (value === 'pueko') throw new createHttpError.Forbidden("Cannot pueko 'pueko'!");
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

app.use(errorHandler());

export default app;
