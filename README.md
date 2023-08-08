# sync-request-curl

[![pipeline](https://github.com/nktnet1/sync-request-curl/actions/workflows/pipeline.yml/badge.svg)](https://github.com/nktnet1/sync-request-curl/actions/workflows/pipeline.yml)
&nbsp;
[![codecov](https://codecov.io/gh/nktnet1/sync-request-curl/branch/main/graph/badge.svg?token=RAC7SKJTGU)](https://codecov.io/gh/nktnet1/sync-request-curl)
&nbsp;
[![Maintainability](https://api.codeclimate.com/v1/badges/3ec8c0ddebe848926277/maintainability)](https://codeclimate.com/github/nktnet1/sync-request-curl/maintainability)

[![Snyk Security](https://snyk.io/test/github/nktnet1/sync-request-curl/badge.svg)](https://snyk.io/test/github/nktnet1/sync-request-curl)
&nbsp;
[![GitHub top language](https://img.shields.io/github/languages/top/nktnet1/sync-request-curl)](https://github.com/search?q=repo%3Anktnet1%2Fsync-request-curl++language%3ATypeScript&type=code)
&nbsp;
[![Depfu Dependencies](https://badges.depfu.com/badges/6c4074c4d23ad57ee2bfd9ff90456090/overview.svg)](https://depfu.com/github/nktnet1/sync-request-curl?project_id=39032)

[![NPM Version](https://img.shields.io/npm/v/sync-request-curl?logo=npm)](https://www.npmjs.com/package/sync-request-curl?activeTab=versions)
&nbsp;
[![NPM License](https://img.shields.io/npm/l/sync-request-curl)](https://opensource.org/license/mit/)
&nbsp;
[![NPM Downloads](https://img.shields.io/npm/dw/sync-request-curl)](https://npm-stat.com/charts.html?package=sync-request-curl)
&nbsp;
[![GitHub stars](https://img.shields.io/github/stars/nktnet1/sync-request-curl.svg?style=social)](https://github.com/nktnet1/sync-request-curl)

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

On MacOS, there may be an error in the installation process.
This can often be fixed by following this [GitHub issue](https://github.com/JCMais/node-libcurl/issues/296).

## 2. Usage

```typescript
request(method, url, options);
```

<details closed>
<summary>Examples (click to view)</summary>

<br/>

`GET` request without options

```typescript
import request from 'sync-request-curl';

const response = request('GET', 'https://comp1531namesages.alwaysdata.net');
console.log('Status Code:', response.statusCode);
const jsonBody = JSON.parse(response.body.toString());
console.log('Returned JSON object:', jsonBody);
```

**`GET`** request with query string parameters

```typescript
import request from 'sync-request-curl';

const response = request(
  'GET',
  'https://comp1531forum.alwaysdata.net/echo/echo',
  {
    qs: { message: 'Hello, world!' },
  }
);
console.log('Status Code:', response.statusCode);
const jsonBody = JSON.parse(response.body.toString());
console.log('Returned JSON object:', jsonBody);
```

**`POST`** request with headers and JSON payload

```typescript
import request from 'sync-request-curl';

const response = request(
  'POST',
  'https://comp1531quiz.alwaysdata.net/quiz/create',
  {
    headers: { lab08quizsecret: "bruno's fight club" },
    json: {
      quizTitle: 'New Quiz',
      quizSynopsis: 'Sync request curl example'
    },
  }
);
console.log('Status Code:', response.statusCode);
const jsonBody = JSON.parse(response.body.toString());
console.log('Returned JSON Object:', jsonBody);

```

</details>

<br/>

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
    <th>Default</th>
  </tr>
  <tr>
    <td>qs</td>
    <td>
      An object containing query string parameters which will be appended to the URL.
    </td>
    <td><code>{ message: 'Hello, world!' }</code></td>
    <td><code>undefined</code></td>
  </tr>
  <tr>
    <td>headers</td>
    <td>
      HTTP headers for the request.
    </td>
    <td><code>{ token: 'abcdefg' }</code></td>
    <td><code>undefined</code></td>
  </tr>
  <tr>
    <td>json</td>
    <td>
      Sets the body as a JSON representation of the value and automatically adds <code>Content-type: application/json</code> to the header.</td>
    <td>
    <code>{ email: 'ab@c.com', password: 'comp1531' }</code></td>
    <td><code>undefined</code></td>
  </tr>
  <tr>
    <td>body</td>
    <td>
      Body for POST and PUT requests. We recommended using <code>json</code> instead for JSON payloads, otherwise the <code>Content-Type</code> will need to be set manually.
    </td>
    <td><code>JSON.stringify({ email: 'ab@c.com', password: 'comp1531' })</code></td>
    <td><code>undefined</code></td>
  </tr>
  <tr>
    <td>timeout</td>
    <td>
      Times out if no response is returned within the given number of milliseconds
    </td>
    <td><code>2000<code></td>
    <td><code>0</code><br/>(never times out)</td>
  </tr>
  <tr>
    <td>followRedirects</td>
    <td>
      Whether redirects (status code 302) should be followed automatically
    </td>
    <td><code>false</code></td>
    <td><code>true</code></td>
  </tr>
  <tr>
    <td>maxRedirects</td>
    <td>Sets the maximum number of redirects to follow before throwing an Error.</td>
    <td><code>3</code></td>
    <td><code>Number.MAX_SAFE_INTEGER</code></td>
  </tr>
  <tr>
    <td>insecure</td>
    <td> Set to false to send insecure requests. This can be useful on Windows which can sometimes have SSL issues (Curlcode 60).</td>
    <td><code>true</code></td>
    <td><code>false</code></td>
  </tr>
</table>

In [src/types.ts](src/types.ts), the following is defined:

```typescript
export interface Options {
  headers?: IncomingHttpHeaders;
  qs?: { [key: string]: any };
  json?: any;
  timeout?: number;
  body?: string | Buffer;
  followRedirects?: boolean;
  maxRedirects?: number;
  sslVerifypeer?: boolean;
}
```

### 2.4. Response

- **`statusCode`** - a number representing the HTTP status code (e.g. `200`, `400`, `401`, `403`)
- **`headers`** - HTTP response headers
- **`body`** - a string or buffer - use `body.toString()` for common use cases in combination with `JSON.parse()`
- **`getBody`** - a function with an optional `encoding` argument that returns the `body` if `encoding` is undefined, otherwise `body.toString(encoding)`. If `statusCode >= 300`, an `Error` is thrown instead.
- **`url`** - the final URL used in the request after all redirections and with the query string parameters appended.

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

[MIT](https://opensource.org/license/mit/)

## 4. Caveats

This library was developed mainly to improve performance with sending synchronous requests in NodeJS.

It was designed to work with UNIX-like systems for UNSW students enrolled in COMP1531 Software Engineering Fundamentals.

Tested to be working on Arch & Debian Linux. Since [node-libcurl](https://github.com/JCMais/node-libcurl) is the core of this module, it is likely also compatible with other operating systems such as MacOS and Windows.
