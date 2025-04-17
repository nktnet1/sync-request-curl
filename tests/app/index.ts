import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';

const app = new Hono();

app.use('*', logger());

app.get('/', (c) => {
  return c.json({ message: 'Hello, world!' });
});

app.get('/get', (c) => {
  const value = c.req.query('value');
  if (value === 'echo') throw new HTTPException(400, { message: "Cannot echo 'echo'!" });
  return c.json({ value });
});

app.delete('/delete', (c) => {
  const value = c.req.header('value');
  if (value === 'header') throw new HTTPException(401, { message: "Cannot header 'header'!" });
  return c.json({ value });
});

app.post('/post', async (c) => {
  const body = await c.req.json();
  const value = body.value;
  if (value === 'post') throw new HTTPException(400, { message: "Cannot post 'post'!" });
  return c.json({ value });
});

app.put('/put', async (c) => {
  const body = await c.req.json();
  const value = body.value;
  if (value === 'put') throw new HTTPException(403, { message: "Cannot put 'put'!" });
  return c.json({ value });
});

app.get('/redirect/source', (c) => {
  const redirectNumber = parseInt(c.req.query('redirectNumber') as string);
  return redirectNumber > 0
    ? c.redirect(`/redirect/source?redirectNumber=${redirectNumber - 1}`, 302)
    : c.redirect('/redirect/destination', 302);
});

app.get('/redirect/destination', (c) => {
  return c.json({ message: 'Redirect success!' });
});

app.post('/content/length', async (c) => {
  const contentLength = parseInt(c.req.header('content-length') as string);
  const buffer = await c.req.arrayBuffer();
  return c.json({
    headerLength: contentLength,
    serverBufferLength: buffer.byteLength
  });
});

app.post('/timeout', async (c) => {
  const body = await c.req.json();
  const startTime = new Date().getTime();
  while (new Date().getTime() - startTime < body.timeout) { /* zzzZZ */ }
  return c.json({});
});

app.onError((err, c) => {
  const status = err instanceof HTTPException ? err.status : 500;
  const message = err instanceof HTTPException ? err.message : 'Internal Server Error';
  return c.json({ error: message }, status);
});

export default app;
