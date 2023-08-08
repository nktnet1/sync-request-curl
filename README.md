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

Leverages [node-libcurl](https://github.com/JCMais/node-libcurl) for performance instead of spawning child processes like sync-request.

This library was designed to run on NodeJS. It will not work in a browser.

- [1. Installation](#1-installation)
- [2. Usage](#2-usage)
	- [2.1. Method](#21-method)
  - [2.2. URL](#22-url)
  - [2.3. Options](#23-options)
  - [2.4. Response](#24-response)
- [3. License](#3-license)
- [4. Windows/MacOS](#4-windowsmacos)
  - [4.1. Windows](#41-windows)
  - [4.2. MacOS](#42-macos)
- [5. Caveats](#5-caveats)

## 1. Installation

```
npm install sync-request-curl
```

Please also refer to the [Windows/MacOS](#4-windowsmacos) section for known issues and workarounds.

## 2. Usage

```typescript
request(method, url, options);
```

<details closed>
<summary>Examples (click to view)</summary>

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

See [sync-request](https://www.npmjs.com/package/sync-request) for the original documentation. All Libcurl Errors will contain a non-zero integer code that can be looked up [here](https://curl.se/libcurl/c/libcurl-errors.html).

Please note that this library only supports a subset of the original features which are summarised below.

### 2.1. Method

HTTP method (of type `HttpVerb`)
- e.g. `PUT`/`POST`/`GET`/`DELETE`.

### 2.2. URL

URL as a string
- e.g. https://toohak.fly.dev

### 2.3. Options

Only the following options from [sync-request](https://www.npmjs.com/package/sync-request) are supported for the time being:

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
    <td>
<pre>
{
  message: 'Hi!'
}
</pre>
    </td>
    <td><code>undefined</code></td>
  </tr>
  <tr>
    <td>headers</td>
    <td>
      HTTP headers for the request.
    </td>
    <td>
<pre>
{
  token: 'abcde'
}
</pre>
    </td>
    <td><code>undefined</code></td>
  </tr>
  <tr>
    <td>json</td>
    <td>
      Sets the body as a JSON representation of the value and automatically adds <code>Content-type: application/json</code> to the header.</td>
    <td>
<pre>{
  name: 'Tam',
  course: 1531
}</pre>
    </td>
    <td><code>undefined</code></td>
  </tr>
  <tr>
    <td>body</td>
    <td>
      Body for POST and PUT requests. We recommended using <code>json</code> instead for JSON payloads, otherwise the <code>Content-Type</code> will need to be set manually.
    </td>
    <td>
<pre>
JSON.stringify({
  name: 'Tam',
  course: 1531
}) </pre></td>
    <td><code>undefined</code></td>
  </tr>
  <tr>
    <td>timeout</td>
    <td>
      Times out if no response is returned within the given number of milliseconds
    </td>
    <td><pre>2000</pre></td>
    <td><code>0</code><br/>(no timeout)</td>
  </tr>
  <tr>
    <td>followRedirects</td>
    <td>
      Sets whether redirects (status code 302) should be followed automatically
    </td>
    <td><pre>false</pre></td>
    <td><code>true</code></td>
  </tr>
  <tr>
    <td>maxRedirects</td>
    <td>Sets the maximum number of redirects to follow before throwing an Error.</td>
    <td><pre>3</pre></td>
    <td><code>-1</code><br/>(no limit)</td>
  </tr>

</table>

<br/>

Below are some additional options available from [node-libcurl](https://github.com/JCMais/node-libcurl):

<table>
  <tr>
    <th>Option</th>
    <th>Description</th>
    <th>Example</th>
    <th>Default</th>
  </tr>
  <tr>
    <td>insecure</td>
    <td> Set to false to send insecure requests. This can be useful on Windows which can sometimes have SSL issues (Curlcode 60).</td>
    <td><pre>true</pre></td>
    <td><code>false</code></td>
  </tr>
  <tr>
    <td>setEasyOptions</td>
    <td>Optional callback to set additional curl options for the <a href='https://curl.se/libcurl/c/easy_setopt_options.html' target="_blank">Easy Interface</a>. This has priority over existing options.</td>
    <td>
<pre>
(curl, opt) => {
  curl.setOpt(
    opt.URL,
    'www.ck'
  );
};
</pre>
    </td>
    <td><code>undefined</code></td>
  </tr>
</table>

<br/>

In [src/types.ts](src/types.ts), the `Options` interface following is defined as:

```typescript
export interface Options {
  /*
   * sync-request options
   */
  headers?: IncomingHttpHeaders;
  qs?: { [key: string]: any };
  json?: any;
  body?: string | Buffer;

  timeout?: number;
  followRedirects?: boolean;
  maxRedirects?: number;

  /*
   * node-libcurl options
   */
  insecure?: boolean;
  setEasyOptions?: SetEasyOptionCallback;
}
```

### 2.4. Response

- **`statusCode`** - a number representing the HTTP status code (e.g. `200`, `400`, `401`, `403`)
- **`headers`** - HTTP response headers
- **`body`** - a string or buffer - use `body.toString()` for common use cases in combination with `JSON.parse()`
- **`getBody`** - a function with an optional `encoding` argument that returns the `body` if `encoding` is undefined, otherwise `body.toString(encoding)`. If `statusCode >= 300`, an `Error` is thrown instead.
- **`url`** - the final URL used in the request after all redirections and with the query string parameters appended.

In [src/types.ts](src/types.ts), the `Response` interface is defined as:

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



<details closed>
<summary><a href="https://opensource.org/license/mit" target="_blank">MIT</a></summary>

```
Copyright (c) 2023 Khiet Tam Nguyen

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the “Software”),
to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense,
and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALING S IN THE SOFTWARE.
```

</details>

## 4. Windows/MacOS

### 4.1. Windows

Your requests may unexpectedly fail with a [Libcurl Error](https://curl.se/libcurl/c/libcurl-errors.html) (code 60, CURLE_PEER_FAILED_VERIFICATION) when using NodeJS natively on Windows.

The reason is covered in the below resources:
- https://github.com/JCMais/node-libcurl/issues/301
- https://stackoverflow.com/a/34883260/22324694

One quick workaround is to set the `insecure` option to `true` when sending your requests. This is the same as setting the Libcurl Easy's equivalent [SSL_VERIFYPEER](https://curl.se/libcurl/c/CURLOPT_SSL_VERIFYPEER.html) to `0`, or using `curl` in the command line with the [`-k` or `--insecure`](https://curl.se/docs/manpage.html#-k) option.

Alternatively, consider using [Windows Subsystem for Linux (WSL)](https://learn.microsoft.com/en-us/windows/wsl/install).

### 4.2. MacOS

The build for MacOS may fail during the installation process.

In most cases, this can be fixed by following these Github issues:
- https://github.com/JCMais/node-libcurl/issues/296
- https://github.com/JCMais/node-libcurl/issues/382

Otherwise, we recommend uninstalling this library and using [sync-request](https://github.com/JCMais/node-libcurl/issues/382) instead.

## 5. Caveats

This library was developed mainly to improve performance with sending synchronous requests in NodeJS.

It was designed to work with UNIX-like systems for UNSW students enrolled in COMP1531 Software Engineering Fundamentals.

It has been tested to be working on Arch & Debian Linux and is compatible with Windows/MacOS
