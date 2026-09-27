## Usage

```typescript
request(method, url, options);
```

The request function is the package default export. ESM consumers can import `FormData` and public types from the root entry; the `/types` subpath remains available explicitly:

```typescript
import request, { FormData } from 'sync-request-curl';
import type { Options, Response } from 'sync-request-curl';
```

<details closed>
<summary>Examples (click to view)</summary>

<br/>

`GET` request without options

```typescript
import request from 'sync-request-curl';

const res = request('GET', 'https://comp1531namesages.alwaysdata.net');
console.log('Status Code:', res.statusCode);
const jsonBody = JSON.parse(res.body.toString());
console.log('Returned JSON object:', jsonBody);
```

**`GET`** request with query string parameters

```typescript
import request from 'sync-request-curl';

const res = request('GET', 'https://comp1531forum.alwaysdata.net/echo/echo', {
  qs: { message: 'Hello, world!' },
});
console.log('Status Code:', res.statusCode);
const jsonBody = JSON.parse(res.body.toString());
console.log('Returned JSON object:', jsonBody);
```

**`POST`** request with headers and JSON payload

```typescript
import request from 'sync-request-curl';

const res = request('POST', 'https://comp1531quiz.alwaysdata.net/quiz/create', {
  headers: { lab08quizsecret: "bruno's fight club" },
  json: {
    quizTitle: 'New Quiz',
    quizSynopsis: 'Sync request curl example',
  },
});

console.log('Status Code:', res.statusCode);
const jsonBody = JSON.parse(res.body.toString());
console.log('Returned JSON Object:', jsonBody);
```

**`POST`** request for file upload using multipart/form-data

```typescript
import { readFileSync } from 'node:fs';
import request, { FormData } from 'sync-request-curl';

const form = new FormData();
form.append('example-file', readFileSync('./path/to/file.txt'), 'file.txt');
form.append('example-content', 'Example Content!');

const res = request('POST', 'https://example.com/upload', { form });
console.log('Status Code:', res.statusCode);
```

Using a proxy URL (Note: replace with your own proxy details)

```javascript
import request from 'sync-request-curl';

const res = request('GET', 'https://ipinfo.io/json', {
  proxy: {
    url: 'http://your-proxy-url:port',
    username: 'proxyUsername',
    password: 'proxyPassword',
  },
});

console.log('Status Code:', res.statusCode);
const jsonBody = res.getJSON();
console.log(jsonBody);
```

</details>

<br/>

### Proxy configuration

Use `proxy: { url, username?, password? }` instead of the former `proxy` string
and separate `proxyAuth` option. `url` is required. Both credential fields can be
omitted for an unauthenticated proxy. A username alone uses an empty password;
`password` requires an explicit `username` (which may be an empty string).

```ts
request('GET', 'https://example.com', {
  proxy: { url: 'http://localhost:8080', username: 'user' },
});
```

Without an explicit username, credentials embedded in `url` are decoded and
used. An explicit username overrides both URL credentials; omitting `password`
in that case sends an empty password, never the password from the URL.
Proxy credentials apply only to the proxy hop. Ambient proxy variables remain
ignored. The former `proxyAuth` option is rejected rather than silently ignored.

When both effective credential fields are empty, libcurl may omit
`Proxy-Authorization` or send an empty Basic credential pair, depending on the
libcurl build. Do not rely on an all-empty pair to force an authentication header.
A non-empty username with an omitted password still uses `username:` credentials.
