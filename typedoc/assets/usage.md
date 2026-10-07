## Usage

```typescript
request(method, url, options);
```

The request function is the package default export. ESM consumers can import
`FormData` and public types from the root entry:

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

`FormData` also exposes the synchronous Node `form-data` helpers used by
[`then-request`](https://github.com/then/then-request):
`getHeaders()`, `getBoundary()`, `setBoundary()`, `getBuffer()`,
`getLengthSync()`, `hasKnownLength()`, and `toString()`. The `append()` options
object supports `filename`, `contentType`, `knownLength`, and the advanced raw
`header` override. A custom `header` is serialized verbatim and is responsible
for its own multipart boundary and part headers. Stream-valued fields and
callback/stream helpers such as `getLength()`, `pipe()`, and `submit()` are not
provided.

Proxy request

```javascript
import request from 'sync-request-curl';

const res = request('GET', 'https://ipinfo.io/json', {
  proxy: {
    url: 'http://your-proxy-url:port',
    username: 'proxyUsername',
    password: 'proxyPassword',
    auth: 'any',
    noProxy: ['localhost', '127.0.0.0/8'],
    headers: {
      'X-Proxy-Trace': 'trace-id',
    },
  },
});

console.log('Status Code:', res.statusCode);
const jsonBody = res.getJSON();
console.log(jsonBody);
```

Proxy URLs can use `http://`, `https://`, `socks4://`, `socks4a://`,
`socks5://`, or `socks5h://`. `auth` applies to HTTP(S) proxies and supports
`basic`, `digest`, `ntlm`, `negotiate`, and `any`; NTLM and Negotiate depend on
the capabilities compiled into the active libcurl build. `noProxy` is an
explicit per-request bypass list and does not re-enable ambient proxy
environment variables. Proxy-specific headers are kept separate from origin
headers during HTTPS CONNECT tunnelling. CIDR entries in `noProxy` require
libcurl 7.86.0 or newer.

Mutual TLS with a client certificate

```typescript
import request from 'sync-request-curl';

const res = request('GET', 'https://service.example', {
  caFile: './service-ca.pem',
  tls: {
    certFile: './client.pem',
    keyFile: './client-key.pem',
    minVersion: 'TLSv1.2',
  },
});

console.log('Status Code:', res.statusCode);
```

For a PKCS#12 identity, set `certType: 'p12'` and provide the `.p12` file as
`certFile`; `passphrase` unlocks either a PKCS#12 identity or an encrypted
private key. A separate `keyFile` is intentionally not accepted with `p12`.
The active libcurl TLS backend determines which client-certificate formats are
supported. The bundled build uses AWS-LC and supports PEM certificate/key pairs as well as
PKCS#12 identities. `minVersion` and `maxVersion` currently accept `TLSv1.2` and `TLSv1.3`.

</details>

<br/>
