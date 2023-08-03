# sync-request-curl

Make synchronous web requests similar to [sync-request](https://github.com/ForbesLindesay/sync-request), but 20 times more quickly.

Leverages [node-libcurl](https://github.com/JCMais/node-libcurl) for performance as opposed to spawning child processes like sync-request.

This library was designed to run on NodeJS. It cannot be used in a browser.

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

On MacOS, there may be an error in the installation process. In most cases can be fixed by following this [GitHub issue](https://github.com/JCMais/node-libcurl/issues/296).

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

URL as a string

e.g. https://toohak.fly.dev

### 2.3. Options

Only the following subset of options is supported for the time being:

<table>
  <tr>
    <th>Option</th>
    <th>Description</th>
    <th>Example</th>
  </tr>
  <tr>
    <td>qs</td>
    <td>
      An object containing query string parameters which will be appended to the URL.
    </td>
    <td><code>{ message: 'Hello, world!' }</code></td>
  </tr>
  <tr>
    <td>headers</td>
    <td>
      HTTP headers for the request.
    </td>
    <td><code>{ token: 'abcdefg' }</code></td>
  </tr>
  <tr>
    <td>json</td>
    <td>
      Sets the body as a JSON representation of the value and automatically adds <code>Content-type: application/json</code> to the header.</td>
    <td>
    <code>{ email: 'example@email.com', password: 'comp1531' }</code></td>
  </tr>
  <tr>
    <td>body</td>
    <td>
      Body for POST and PUT requests. We recommended using <code>json</code> instead for JSON payloads, otherwise the <code>Content-Type</code> will need to be set manually.
    </td>
    <td><code>JSON.stringify({ email: 'example@email.com', password: 'comp1531' })</code></td>
  </tr>
  <tr>
    <td>timeout</td>
    <td>
      Times out if no response is returned within the given number of milliseconds
    </td>
    <td><code>2000<code></td>
  </tr>
  <tr>
    <td>followRedirects</td>
    <td>
      Defaults to true, but can be set to false to not follow any redirects (302) automatically
    </td>
    <td><code>false</code></td>
  </tr>
  <tr>
    <td>maxRedirects</td>
    <td>Sets the maximum number of redirects to follow before throwing an Error. Defaults to <code>NumberMAX_SAFE_INTEGER</code>.</td>
    <td><code>3</code></td>
  </tr>
</table>

In [src/types.ts](src/types.ts), the following is defined:

```typescript
export interface Options {
  headers?: IncomingHttpHeaders;
  qs?: {
    [key: string]: any;
  };
  json?: any;
  timeout?: number;
  body?: string | Buffer | NodeJS.ReadableStream;
  followRedirects?: boolean;
  maxRedirects?: number;
}
```

### 2.4. Response

- **`statusCode`** - a number representing the HTTP status code (e.g. `200`, `400`, `401`, `403`)
- **`headers`** - HTTP response headers
- **`body`** - a string or buffer - use `body.toString()` for common use cases in combination with `JSON.parse()`
- **`getBody`** - a function with an optional `encoding` argument that returns the `body` if `encoding` is `undefined`, otherwise `body.toString(encoding)`. If the `statusCode >= 300`, an `Error` is thrown instead.
- **`url`** - the final URL with query string parameters appended and if any redirection occurred.

In [src/types.ts](src/types.ts), the following is defined:

```typescript
export interface Response {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: string | Buffer;
  getBody: (encoding?: BufferEncoding) => string | Buffer; // simplified
  url: string;
}
```

## 3. License

MIT

## 4. Caveats

This library was developed mainly to improve performance with sending synchronous requests in NodeJS.

It was designed to work with UNIX-like systems for UNSW students enrolled in COMP1531 Software Engineering Fundamentals.

Tested to be working on Arch & Debian Linux. Since [node-libcurl](https://github.com/JCMais/node-libcurl) is the core of this module, it is likely also compatible with other operating systems such as MacOS and Windows.