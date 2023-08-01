# sync-request-curl

Make synchronous web requests similar to [sync-request](https://github.com/ForbesLindesay/sync-request),
but up to 15-20 times more quickly.

Leverages [node-libcurl](https://github.com/JCMais/node-libcurl) for performance as opposed to spawning child process like sync-request.

## Installation
```
npm install sync-request-curl
```

## Usage

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
    qs: { message: 'helloworld' }
  }
);

console.log(response.statusCode)
console.log(response.body.toString());
```

See the full documentation at [sync-request](https://www.npmjs.com/package/sync-request)'s documentation.

Please note that this library only supports a subset of the available features (further details below).

### Method:

HTTP method (of type `HttpVerb`), e.g. `PUT`/`POST`/`GET`/`DELETE`

```typescript
import request, { HttpVerb } from 'sync-request-curl;
```

### URL:

URL as a string, e.g. https://toohak.fly.dev

### Options:

Only this subset of options from sync-request are currently supported:

- `qs` - an object containing querystring values to be appended to the URL
- `headers` - http headers
- `body` - body for PATCH, POST and PUT requests. Must be a Buffer or String (only strings are accepted client side)
- `json` - sets body but to JSON representation of value and adds Content-type: application/json. Does not have any affect on how the response is treated.
- `timeout` (default: false) - times out if no response is returned within the given number of milliseconds.

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

### Response

- **`statusCode`** - a number representing the HTTP status code
- **`headers`** - HTTP response headers
- **`body`** - a string or buffer. In most cases, use `body.toString()` for string
- **`getBody`** - a function with an optional encoding argument that returns the body (if encoding is undefined), or `body.toString(encoding)` otherwise. Note that if the `statusCode` is above 300, an `Error` is thrown instead.

In [src/types.ts](src/types.ts), the following is defined:

```typescript
export interface Response {
  statusCode: number;
  headers: OutgoingHttpHeaders;
  body: string | Buffer;
  getBody: (encoding?: BufferEncoding) => string | Buffer;
}
```

## License

MIT

## Other notes

This library was developed mainly to improve performance with sending synchronous requests in NodeJS.

It was designed to work with UNIX-like systems for UNSW students enrolled in COMP1531 Software Fundamentals.