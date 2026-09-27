<div align="center">

# [![Sync Request Curl](logo.svg)](https://github.com/nktnet1/sync-request-curl)

[![pipeline](https://github.com/nktnet1/sync-request-curl/actions/workflows/pipeline.yaml/badge.svg)](https://github.com/nktnet1/sync-request-curl/actions/workflows/pipeline.yaml)
&nbsp;
[![codecov](https://codecov.io/gh/nktnet1/sync-request-curl/branch/main/graph/badge.svg?token=RAC7SKJTGU)](https://codecov.io/gh/nktnet1/sync-request-curl)
&nbsp;
[![Maintainability](https://api.codeclimate.com/v1/badges/3ec8c0ddebe848926277/maintainability)](https://codeclimate.com/github/nktnet1/sync-request-curl/maintainability)
&nbsp;
[![Snyk Security](https://snyk.io/test/github/nktnet1/sync-request-curl/badge.svg)](https://snyk.io/test/github/nktnet1/sync-request-curl)
&nbsp;
[![GitHub top language](https://img.shields.io/github/languages/top/nktnet1/sync-request-curl)](https://github.com/search?q=repo%3Anktnet1%2Fsync-request-curl++language%3ATypeScript&type=code)

[![NPM Version](https://img.shields.io/npm/v/sync-request-curl?logo=npm)](https://www.npmjs.com/package/sync-request-curl?activeTab=versions)
&nbsp;
[![Depfu Dependencies](https://badges.depfu.com/badges/6c4074c4d23ad57ee2bfd9ff90456090/overview.svg)](https://depfu.com/github/nktnet1/sync-request-curl?project_id=39032)
&nbsp;
[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fnktnet1%2Fsync-request-curl.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2Fnktnet1%2Fsync-request-curl?ref=badge_shield)
&nbsp;
[![NPM License](https://img.shields.io/npm/l/sync-request-curl)](https://opensource.org/license/mit/)
&nbsp;
[![GitHub issues](https://img.shields.io/github/issues/nktnet1/sync-request-curl.svg?style=social)](https://github.com/nktnet1/sync-request-curl/issues)

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=nktnet1_sync-request-curl&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=nktnet1_sync-request-curl)
&nbsp;
[![Codacy Badge](https://app.codacy.com/project/badge/Grade/f222c2e572fc41b7b45c3591c3575a9d)](https://app.codacy.com/gh/nktnet1/sync-request-curl/dashboard?utm_source=gh&utm_medium=referral&utm_content=&utm_campaign=Badge_grade)
&nbsp;
[![DeepSource](https://app.deepsource.com/gh/nktnet1/sync-request-curl.svg/?label=active+issues&show_trend=true&token=OTP6tE2be4X1kvxZRsxRh25e)](https://app.deepsource.com/gh/nktnet1/sync-request-curl/)
&nbsp;
[![GitHub stars](https://img.shields.io/github/stars/nktnet1/sync-request-curl.svg?style=social)](https://github.com/nktnet1/sync-request-curl/stargazers)

---

Make synchronous web requests similar to [sync-request](https://github.com/ForbesLindesay/sync-request), but up to 20 times more quickly.

</div>

---

- [1. Installation](#installation)
- [2. Usage](#usage)
  - [2.1. Proxy configuration](#usage-proxy-configuration)
- [3. API reference](#api-reference)
- [4. Differences from `sync-request`](#differences-from-sync-request)
  - [4.1. What `sync-request-curl` adds](#differences-from-sync-request-what-sync-request-curl-adds)
  - [4.2. Where behaviour differs](#differences-from-sync-request-where-behaviour-differs)
- [5. License](#license)
- [6. Compatibility](#compatibility)
  - [6.1. Windows](#compatibility-windows)
  - [6.2. macOS](#compatibility-macos)
  - [6.3. Linux](#compatibility-linux)
  - [6.4. Building from source](#compatibility-building-from-source)
- [7. Caveats](#caveats)

<a id="installation"></a>
## 1. Installation

```
npm install sync-request-curl
```

<a id="usage"></a>
## 2. Usage

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

<a id="usage-proxy-configuration"></a>
### 2.1. Proxy configuration

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

<a id="api-reference"></a>
## 3. API reference

### Request

#### request()

```ts
function request(
   method,
   url,
   options?
): Response;
```

Perform a synchronous HTTP(S) request and return the complete buffered
response.

##### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `method` | `string` | Valid HTTP method token. Matching is case-insensitive. |
| `url` | `string` \| `URL` | Absolute `http:` or `https:` URL, provided as a string or `URL`. |
| `options` | [`Options`](#options) | Request, transport, redirect, retry, and cache options. |

##### Returns

[`Response`](#response)

The buffered response after redirects and retries complete.

***

#### JsonLike

```ts
type JsonLike = JsonLikeValue;
```

Values accepted for JSON request bodies.

This intentionally follows practical `JSON.stringify()` inputs rather than
only strict JSON syntax. `undefined` is allowed inside objects and arrays,
and objects with `toJSON()` (for example `Date`) are supported.

***

#### HttpVerb

```ts
type HttpVerb = string;
```

Any valid HTTP method token. Input is case-insensitive and is normalised to
uppercase before transport.

***

#### Options

```ts
type Options = {
  proxy?: ProxyOptions;
  rejectUnauthorized?: boolean;
  caFile?: string;
  localAddress?: string;
  localInterface?: string;
  tcpKeepAlive?:   | boolean
     | {
     idleSeconds?: number;
     intervalSeconds?: number;
   };
  cacheNamespace?: string;
  headers?: {
   [key: string]: string | string[] | undefined;
  };
  qs?: {
   [key: string]: unknown;
  };
  json?: JsonLikeValue;
  body?: string | Buffer<ArrayBufferLike>;
  form?: FormData;
  timeout?: number;
  overallTimeout?: number;
  socketTimeout?: number;
  followRedirects?: boolean;
  maxRedirects?: number;
  allowRedirectHeaders?: string[];
  gzip?: boolean;
  cache?: "file" | "memory";
  agent?: boolean | Agent;
  retry?: boolean | RetryFunction;
  retryDelay?: number | RetryDelayFunction;
  maxRetries?: number;
};
```

Options accepted by `request`.

Payload precedence is `form`, then `json`, then `body` when more than one is
supplied.

##### Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| <a id="property-proxy"></a> `proxy?` | [`ProxyOptions`](#proxyoptions) | Explicit HTTP/HTTPS proxy origin URL. Ambient proxy variables are ignored. |
| <a id="property-rejectunauthorized"></a> `rejectUnauthorized?` | `boolean` | Verify the origin certificate chain and hostname. Defaults to `true`. |
| <a id="property-cafile"></a> `caFile?` | `string` | PEM CA bundle path for origin TLS verification. |
| <a id="property-localaddress"></a> `localAddress?` | `string` | Source IPv4/IPv6 address. Hostnames are rejected. |
| <a id="property-localinterface"></a> `localInterface?` | `string` | Source interface name. Mutually exclusive with `localAddress`. |
| <a id="property-tcpkeepalive"></a> `tcpKeepAlive?` | \| `boolean` \| \{ `idleSeconds?`: `number`; `intervalSeconds?`: `number`; \} | Enable TCP keepalive, optionally with idle and interval controls. |
| <a id="property-cachenamespace"></a> `cacheNamespace?` | `string` | Private cache identity. Defaults to `process.cwd()`. |
| <a id="property-headers-1"></a> `headers?` | \{ \[`key`: `string`\]: `string` \| `string`[] \| `undefined`; \} | Node-style request headers. |
| <a id="property-qs"></a> `qs?` | \{ \[`key`: `string`\]: `unknown`; \} | Query values merged with any existing query string. |
| <a id="property-json"></a> `json?` | `JsonLikeValue` | JSON-compatible request body. Adds `application/json` when needed. |
| <a id="property-body-1"></a> `body?` | `string` \| `Buffer`\<`ArrayBufferLike`\> | Raw string or `Buffer` request body. |
| <a id="property-form"></a> `form?` | [`FormData`](#formdata) | Synchronous multipart/form-data body. |
| <a id="property-timeout"></a> `timeout?` | `number` | Per-network-attempt timeout in milliseconds. `0` disables it. |
| <a id="property-overalltimeout"></a> `overallTimeout?` | `number` | Complete-operation deadline in milliseconds. `0` disables it. |
| <a id="property-sockettimeout"></a> `socketTimeout?` | `number` | Socket inactivity timeout in milliseconds. `0` disables it. |
| <a id="property-followredirects"></a> `followRedirects?` | `boolean` | Follow redirects automatically. Defaults to `true`. |
| <a id="property-maxredirects"></a> `maxRedirects?` | `number` | Maximum redirects to follow. Negative or non-finite values mean no limit. |
| <a id="property-allowredirectheaders"></a> `allowRedirectHeaders?` | `string`[] | Caller headers allowed to be forwarded to redirect hops. |
| <a id="property-gzip"></a> `gzip?` | `boolean` | Transparently decompress gzip/deflate responses. Defaults to enabled. |
| <a id="property-cache"></a> `cache?` | `"file"` \| `"memory"` | Enable the private HTTP-aware cache in file or memory storage. |
| <a id="property-agent"></a> `agent?` | `boolean` \| `Agent` | `sync-request` boolean agent option, or a keep-alive Node `Agent`. |
| <a id="property-retry"></a> `retry?` | `boolean` \| [`RetryFunction`](#retryfunction) | Retry GET requests, or provide a callback to decide per attempt. |
| <a id="property-retrydelay"></a> `retryDelay?` | `number` \| [`RetryDelayFunction`](#retrydelayfunction) | Retry delay in milliseconds, or a callback returning the delay. |
| <a id="property-maxretries"></a> `maxRetries?` | `number` | Maximum retry count. Defaults to 5 when retries are enabled. |

***

#### ProxyOptions

An explicit HTTP/HTTPS proxy and optional Basic credentials.

##### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-url-1"></a> `url` | `string` | HTTP/HTTPS proxy origin URL. May contain URL-encoded credentials. |
| <a id="property-username"></a> `username?` | `string` | Overrides both URL credentials. An omitted password becomes an empty string. |
| <a id="property-password"></a> `password?` | `string` | Proxy password. Requires an explicit username; defaults to an empty string. |

***

#### RetryResponse

Response shape passed to retry policy callbacks.

`getBody()` follows the same status handling as a normal response. Retry
callbacks receive this buffered response before the next attempt begins.

##### Methods

###### getBody()

###### Call Signature

```ts
getBody(encoding): string;
```

Read the response body as a string using the requested encoding.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `encoding` | `BufferEncoding` |

###### Returns

`string`

###### Call Signature

```ts
getBody(): Buffer;
```

Read the response body as a `Buffer`.

###### Returns

`Buffer`

##### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-statuscode-2"></a> `statusCode` | `number` | HTTP response status code. |
| <a id="property-headers-3"></a> `headers` | \{ \[`key`: `string`\]: `string` \| `string`[] \| `undefined`; \} | Node-style response headers with lowercase keys. |
| <a id="property-url-2"></a> `url` | `string` | Final effective URL for the completed attempt. |
| <a id="property-body-3"></a> `body` | `Buffer` | Buffered response body. |

***

#### RetryFunction

```ts
type RetryFunction = (error, response, attemptNumber) => boolean;
```

Decide whether a GET request should be retried after an error or response.

`attemptNumber` starts at 1 for the first completed attempt.

##### Parameters

| Parameter | Type |
| ------ | ------ |
| `error` | `Error` \| `null` |
| `response` | [`RetryResponse`](#retryresponse) \| `undefined` |
| `attemptNumber` | `number` |

##### Returns

`boolean`

***

#### RetryDelayFunction

```ts
type RetryDelayFunction = (error, response, attemptNumber) => number;
```

Return the delay in milliseconds before the next retry.

`attemptNumber` starts at 1 for the first completed attempt.

##### Parameters

| Parameter | Type |
| ------ | ------ |
| `error` | `Error` \| `null` |
| `response` | [`RetryResponse`](#retryresponse) \| `undefined` |
| `attemptNumber` | `number` |

##### Returns

`number`

### Response

#### BufferEncoding

```ts
type BufferEncoding =
  | "base64"
  | "ascii"
  | "utf8"
  | "utf-8"
  | "utf16le"
  | "ucs2"
  | "ucs-2"
  | "base64url"
  | "latin1"
  | "binary"
  | "hex";
```

Buffer encodings accepted by response body helpers.

***

#### GetBody

```ts
type GetBody = {
<Encoding>  (encoding): string;
  (): Buffer;
};
```

Read the current response body.

Calling without an encoding returns the `Buffer`. Passing an encoding returns
a string. A response with `statusCode >= 300` throws `ResponseError`.

##### Call Signature

```ts
<Encoding>(encoding): string;
```

###### Type Parameters

| Type Parameter |
| ------ |
| `Encoding` *extends* \| `"base64"` \| `"ascii"` \| `"utf8"` \| `"utf-8"` \| `"utf16le"` \| `"ucs2"` \| `"ucs-2"` \| `"base64url"` \| `"latin1"` \| `"binary"` \| `"hex"` |

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `encoding` | `Encoding` |

###### Returns

`string`

##### Call Signature

```ts
(): Buffer;
```

###### Returns

`Buffer`

***

#### GetJSON

```ts
type GetJSON = <T>(encoding?) => T;
```

Parse the current response body as JSON.

Unlike `GetBody`, this helper does not reject HTTP error status codes;
it only throws if the body cannot be parsed as JSON.

##### Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `T` | `unknown` |

##### Parameters

| Parameter | Type |
| ------ | ------ |
| `encoding?` | [`BufferEncoding`](#bufferencoding) |

##### Returns

`T`

***

#### Response

Buffered synchronous response returned by `request`.

Helper methods observe later mutations to the public response object rather
than a hidden immutable snapshot.

##### Properties

| Property | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-getbody"></a> `getBody` | [`GetBody`](#getbody) | `undefined` | Read the response body and throw `ResponseError` for HTTP status >= 300. |
| <a id="property-getjson"></a> `getJSON` | [`GetJSON`](#getjson) | `undefined` | Parse the response body as JSON without applying HTTP status handling. |
| <a id="property-statuscode-1"></a> `statusCode` | `number` | `undefined` | HTTP response status code. |
| <a id="property-headers-2"></a> `headers` | \{ \[`key`: `string`\]: `string` \| `string`[] \| `undefined`; \} | `incomingHttpHeadersSchema` | Node-style response headers with lowercase keys. |
| <a id="property-url"></a> `url` | `string` | `undefined` | Final effective URL after query handling and redirects. |
| <a id="property-body-2"></a> `body` | `Buffer`\<`ArrayBufferLike`\> | `undefined` | Mutable buffered response body. |

### Multipart

#### FormDataEntry

One multipart entry accepted by `FormData`.

##### Properties

| Property | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-key"></a> `key` | `string` | `metadataSchema` | Multipart field name. |
| <a id="property-value"></a> `value` | `string` \| `Buffer`\<`ArrayBufferLike`\> \| `Blob` | `undefined` | Text, `Buffer`, or `Blob` field value. |
| <a id="property-filename"></a> `fileName?` | `string` | `undefined` | Optional file name. Path components are stripped before sending. |

***

#### FormData

Synchronous multipart/form-data builder compatible with `sync-request`.

Pass an instance through the request `form` option.

##### Constructors

###### Constructor

```ts
new FormData(): FormData;
```

###### Returns

[`FormData`](#formdata)

##### Methods

###### append()

```ts
append(
   key,
   value,
   fileName?
): void;
```

Append a text, `Buffer`, or `Blob` field.

When `fileName` is supplied, its basename is used and the media type is
inferred from the extension with an `application/octet-stream` fallback.
Blob media types remain authoritative.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `key` | `string` |
| `value` | `string` \| `Buffer`\<`ArrayBufferLike`\> \| `Blob` |
| `fileName?` | `string` |

###### Returns

`void`

### Errors

#### RequestErrorCode

```ts
type RequestErrorCode =
  | "ERR_INVALID_URL"
  | "ENOTFOUND"
  | "ETIMEDOUT"
  | "ERR_TOO_MANY_REDIRECTS"
  | "ERR_REQUEST_FAILED";
```

Stable transport-neutral error codes emitted by the TypeScript request layer.

***

#### CurlError

Raw libcurl transport failure.

The numeric `code` is retained for compatibility with earlier
`sync-request-curl` releases and maps to libcurl's documented error codes.

##### Extends

- `Error`

##### Constructors

###### Constructor

```ts
new CurlError(code, message): CurlError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `code` | `number` |
| `message` | `string` |

###### Returns

[`CurlError`](#curlerror)

###### Overrides

```ts
Error.constructor
```

##### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-code"></a> `code` | `number` | Numeric libcurl error code. |

***

#### RequestError

Transport-neutral request failure created by the TypeScript request layer.

##### Extends

- `Error`

##### Constructors

###### Constructor

```ts
new RequestError(
   code,
   message,
   options?
): RequestError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `code` | \| `"ERR_INVALID_URL"` \| `"ENOTFOUND"` \| `"ETIMEDOUT"` \| `"ERR_TOO_MANY_REDIRECTS"` \| `"ERR_REQUEST_FAILED"` |
| `message` | `string` |
| `options?` | \{ `cause?`: `unknown`; \} |
| `options.cause?` | `unknown` |

###### Returns

[`RequestError`](#requesterror)

###### Overrides

```ts
Error.constructor
```

##### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-code-1"></a> `code` | `readonly` | \| `"ERR_INVALID_URL"` \| `"ENOTFOUND"` \| `"ETIMEDOUT"` \| `"ERR_TOO_MANY_REDIRECTS"` \| `"ERR_REQUEST_FAILED"` | Stable transport-neutral request error code. |

***

#### ResponseError

HTTP status error thrown by `response.getBody()` for status codes >= 300.

The status, headers, and body that produced the error remain available on
the error object.

##### Extends

- `Error`

##### Constructors

###### Constructor

```ts
new ResponseError(
   statusCode,
   headers,
   body,
   encoding?
): ResponseError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `statusCode` | `number` |
| `headers` | \{ \[`key`: `string`\]: `string` \| `string`[] \| `undefined`; \} |
| `body` | `Buffer` |
| `encoding?` | \| `"base64"` \| `"ascii"` \| `"utf8"` \| `"utf-8"` \| `"utf16le"` \| `"ucs2"` \| `"ucs-2"` \| `"base64url"` \| `"latin1"` \| `"binary"` \| `"hex"` |

###### Returns

[`ResponseError`](#responseerror)

###### Overrides

```ts
Error.constructor
```

##### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-statuscode"></a> `statusCode` | `readonly` | `number` | HTTP status code that caused the error. |
| <a id="property-headers"></a> `headers` | `readonly` | \{ \[`key`: `string`\]: `string` \| `string`[] \| `undefined`; \} | Response headers returned by the server. |
| <a id="property-body"></a> `body` | `readonly` | `Buffer` | Buffered response body returned by the server. |

<a id="differences-from-sync-request"></a>
## 4. Differences from `sync-request`

If you already use `sync-request`, most code should feel familiar. The main differences are the extra controls `sync-request-curl` provides and a few cases where its behaviour is more explicit.

<a id="differences-from-sync-request-what-sync-request-curl-adds"></a>
### 4.1. What `sync-request-curl` adds

- `Response#getJSON()` is available as a convenience helper.
- `cache: "memory"` is available as an alternative to the file cache.
- `retry` and `retryDelay` can be callbacks when you need to decide retry behaviour at runtime.
- `agent` still accepts the boolean values supported by `sync-request`, and can also take a keep-alive Node `Agent` for connection reuse.
- `overallTimeout` sets a deadline for the whole operation, alongside the per-attempt `timeout` and inactivity `socketTimeout` options.
- Proxy, TLS, local network binding, and TCP keepalive have dedicated options instead of requiring low-level libcurl callbacks.

<a id="differences-from-sync-request-where-behaviour-differs"></a>
### 4.2. Where behaviour differs

- Request bodies are allowed on `GET`, `DELETE`, and `HEAD`, and falsy JSON values such as `false`, `0`, `""`, and `null` are valid payloads.
- Invalid HTTP framing is rejected rather than sending conflicting `Content-Length` and `Transfer-Encoding` headers.
- Only absolute `http:` and `https:` URLs are accepted. Proxy environment variables are ignored; use the `proxy` option when proxying a request.
- An explicit `Authorization` header takes precedence over credentials in the URL, and a caller-supplied `Accept-Encoding` header is left unchanged.
- 307 and 308 redirects preserve the request method and body. `sync-request` can rewrite some body-bearing redirects to `GET`.
- Query merging preserves additional literal `?` and `#` delimiters that `sync-request` can truncate while splitting URLs.
- Cache handling is stricter: `no-store` takes precedence, `Age` is updated on cache hits, cached headers are isolated from mutation, and recoverable cache-read errors are treated as misses.
- HTTPS requests can use HTTP/2 automatically when the available libcurl supports it.

<a id="license"></a>
## 5. License

[MIT License](LICENSE)

<a id="compatibility"></a>
## 6. Compatibility

`sync-request-curl` supports Node.js 16.17.0 and newer at runtime. The native addon targets Node-API v8, so a prebuilt addon is tied to its operating system, CPU architecture, and C runtime, but not to a specific Node.js major version. The same prebuilt binary can be reused by Node.js releases that support Node-API v8.

Repository build and release automation runs on newer Node.js versions independently of the published runtime requirement. The optional source-build entry point is plain JavaScript and runs on Node.js 16.17.0 or newer.

The published package does not download or compile native code during installation. Each release declares platform-specific optional packages, so the package manager installs only the native binary compatible with the current operating system, CPU architecture, and Linux C runtime. If optional dependencies are disabled or a matching package is unavailable, loading fails with an explicit error with instructions for an explicit source build. Compilation is never triggered by importing the library.

<a id="compatibility-windows"></a>
### 6.1. Windows

Prebuilt addons are prepared for x64, arm64, and x86 (`ia32`) Windows. The x86 addon is built and load-checked with 32-bit Node.js 22; use a Node.js release that provides an x86 runtime. No Visual Studio, Python, Rust, CMake, vcpkg, or node-gyp installation is required by package consumers.

Requests may still fail with Libcurl Error 60 (`CURLE_PEER_FAILED_VERIFICATION`) when the peer certificate cannot be verified. `rejectUnauthorized: false` disables origin certificate and hostname verification and should only be used when that trade-off is intentional.

<a id="compatibility-macos"></a>
### 6.2. macOS

Prebuilt addons are prepared for Apple Silicon (`arm64`) and Intel (`x64`) macOS. No Xcode command-line tools or local libcurl installation is required by package consumers.

<a id="compatibility-linux"></a>
### 6.3. Linux

Prebuilt addons are prepared for both glibc and musl on x64 and arm64 Linux. This covers the common Debian, Ubuntu, Arch, and Alpine variants without compiling native code during installation. GNU/Linux release binaries are built against a GLIBC 2.31 baseline, while Alpine binaries are built and tested in a musl environment.

<a id="compatibility-building-from-source"></a>
### 6.4. Building from source

The npm package includes the Rust addon sources and Cargo lockfile. If your
architecture has no prebuilt package, or you need a build for your local system,
install normally and explicitly compile the installed package:

```sh
npm install sync-request-curl
node node_modules/sync-request-curl/native/build.mjs
```

Run this with the same Node.js architecture that will use the library. This works
with installation scripts disabled and does not require node-gyp or development
JavaScript dependencies. With a nonstandard package layout, locate the installed
package using `require.resolve('sync-request-curl/package.json')`, then run
`native/build.mjs` within that package. Rebuild after replacing or upgrading it.

Prerequisites:

- Rust 1.88 or newer and Cargo (rustup uses the included pinned toolchain).
- Linux/other Unix: a C/C++ compiler, make, Perl, and pkg-config; install your
  distribution's development tools and CA certificates.
- macOS: Xcode Command Line Tools; the addon uses system libcurl.
- Windows: Visual Studio C++ Build Tools and Windows SDK for the target CPU.
  For x86, also install `rustup target add i686-pc-windows-msvc`.
- Access to the locked Cargo dependencies, or an already populated Cargo cache.

Linux builds bundle libcurl, HTTP/2, and OpenSSL. musl builds disable Rust's
static CRT mode so Node.js can load the shared addon. Source builds inherit the
local system's compatibility baseline, not the release prebuilds' GLIBC baseline.

The source builder does not restrict CPU architectures to the prebuilt matrix.
Additional Linux architectures (for example ARMv7, ppc64, s390x, and riscv64) and
other Unix platforms are best-effort: they need compatible Node.js, Rust, and
native dependencies and are not covered by release CI. A source-build route is
not a guarantee that every upstream dependency supports every target.

`CARGO_BUILD_TARGET` can select a Rust target when the Rust host differs from
Node.js (for example an ARMv7 ABI). Install that target and configure its C/linker
toolchain yourself. The builder must run on the destination system with matching
Node.js: it verifies the addon before installing it and is not a general-purpose
cross-compilation command. Windows defaults to the MSVC target matching Node.js.

The loader prefers `native/build/sync_request_curl_native.node` before detecting
prebuilt targets, including on unlisted architectures. For an externally managed
build, set `SYNC_REQUEST_CURL_NATIVE_PATH` to its absolute `.node` path. Invalid
local or explicitly selected binaries fail visibly rather than silently loading
a different binary. Normal prebuilt installations still require no build tools.

For repository development (Node.js 24.14+ or 26+), use:

```sh
pnpm build:native
pnpm test:source-build
pnpm test
```

`build:native` explicitly invokes Cargo even when a prebuild exists. The
source-build checks test orchestration and failure handling with mocked compiler
processes; `pnpm test` exercises the real addon, preferring the local build.
The build itself validates addon loading before installing the output. For a
standalone load check after compilation:

```sh
node scripts/verify-native-load.ts --file=native/build/sync_request_curl_native.node
```

For an installed package, run the source-build command shown above, then import
`sync-request-curl` normally. No environment override is needed. Keep the build
on the machine, architecture, and C runtime that will execute your application.

<a id="caveats"></a>
## 7. Caveats

**sync-request-curl** was developed to improve performance with sending synchronous requests in Node.js. It is also free from the sync-request bug which leaves an orphaned sync-rpc process, resulting in a [leaked handle being detected in Jest](https://github.com/ForbesLindesay/sync-request/issues/129).

**sync-request-curl** was designed to work with UNIX-like systems for UNSW students enrolled in [COMP1531 Software Engineering Fundamentals](https://webcms3.cse.unsw.edu.au/COMP1531/23T2/outline). The native distribution targets glibc- and musl-based Linux, Windows, and macOS on the architectures listed in the compatibility section.

Please note that this library's primary goal is to simplify the learning of JavaScript for novice programmers, hence its synchronous nature. However, we recommend to **always use an [asynchronous alternative](https://blog.appsignal.com/2024/09/11/top-5-http-request-libraries-for-nodejs.html)** where possible.
