
# sync-request-curl

Make synchronous web requests similar to [sync-request](https://github.com/ForbesLindesay/sync-request), but 20 times more quickly.

Leverages [node-libcurl](https://github.com/JCMais/node-libcurl) for performance as opposed to spawning child processes like sync-request.

This library cannot be used in a browser.


- [1. Installation](#1-installation)
- [2. Usage](#2-usage)
	- [2.1. Method](#21-method)
  - [2.2. URL](#22-url)
  - [2.3. Options](#23-options)
  - [2.4. Response](#24-response)
- [3. License](#3-license)
- [4. Caveats](#4-caveats)

## 1. Installation
```
npm install sync-request-curl
```

## 2. Usage

```typescript
request(method, url, options);
```

e.g.

```typescript
import request from 'sync-request-curl';

const response = request(
  'GET',
  'https://comp1531forum.alwaysdata.net/echo/echo',
  {
    qs: { message: 'Hello, world!' }
  }
);

console.log(response.statusCode)
console.log(response.body.toString());
```

See [sync-request](https://www.npmjs.com/package/sync-request) for the original documentation.

Please note that this library only supports a subset of the original features, which are summarised below.

### 2.1. Method

HTTP method (of type `HttpVerb`)

e.g. `PUT`/`POST`/`GET`/`DELETE`.

### 2.2. URL

URL as a string.

e.g. https://toohak.fly.dev

### 2.3. Options

Only the following subset of options are supported for the time being:

- **`qs`** - an object containing query string values to be appended to the URL, e.g. `{ message: 'Hello, world!' }`
- **`headers`** - HTTP headers, e.g. `{ token: 'abcdefg' }`
- **`body`** - body for POST and PUT requests, e.g. `JSON.stringify({ email: 'example@email.com', password: 'comp1531' })`
- **`json`** - sets body as JSON representation of value and adds `Content-type: application/json` to the headers.
- **`timeout`** - times out if no response is returned within the given number of milliseconds, e.g. `2000`.

In [src/types.ts](src/types.ts), the following is defined:

```typescript
export interface Options {
  headers?: IncomingHttpHeaders;
  timeout?: number;
  qs?: {
    [key: string]: any;
  };
  json?: any;
  body?: string | Buffer | NodeJS.ReadableStream;
}
```

### 2.4. Response

- **`statusCode`** - a number representing the HTTP status code (e.g. `200`, `400`, `401`, `403`)
- **`headers`** - HTTP response headers
- **`body`** - a string or buffer - use `body.toString()` for common use cases.
- **`getBody`** - a function with an optional `encoding` argument that returns the `body` if `encoding` is `undefined`, otherwise `body.toString(encoding)`. If the `statusCode >= 300`, an `Error` is thrown instead.

In [src/types.ts](src/types.ts), the following is defined:

```typescript
export interface Response {
  statusCode: number;
  headers: OutgoingHttpHeaders;
  body: string | Buffer;
  getBody: (encoding?: BufferEncoding) => string | Buffer;
}
```

## 3. License

MIT

## 4. Caveats

This library was developed mainly to improve performance with sending synchronous requests in NodeJS.

It was designed to work with UNIX-like systems for UNSW students enrolled in COMP1531 Software Fundamentals.

Tested to be working on Arch & Debian Linux. Since [node-libcurl](https://github.com/JCMais/node-libcurl) is the core of this module, it is likely also compatible with other operating systems such as MacOS and Windows.