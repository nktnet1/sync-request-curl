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

Designed to run on NodeJS. It will not work in a browser.

[![Try with Replit](https://replit.com/badge?caption=Try%20with%20Replit)](https://replit.com/@nktnet1/sync-request-curl-example#index.js)

</div>

---

- [1. Installation](#installation)
- [2. Usage](#usage)
- [3. API reference](#api-reference)
- [4. Differences from `sync-request`](#differences-from-sync-request)
  - [4.1. Intentional additions](#differences-from-sync-request-intentional-additions)
  - [4.2. Intentional behavioural differences](#differences-from-sync-request-intentional-behavioural-differences)
  - [4.3. Out of scope](#differences-from-sync-request-out-of-scope)
  - [4.4. Migrating from v4](#differences-from-sync-request-migrating-from-v4)
- [5. License](#license)
- [6. Compatibility](#compatibility)
  - [6.1. Windows](#compatibility-windows)
  - [6.2. macOS](#compatibility-macos)
  - [6.3. Linux](#compatibility-linux)
- [7. Caveats](#caveats)

<a id="installation"></a>
## 1. Installation

```
npm install sync-request-curl
```

<a id="usage"></a>
## 2. Usage

Try with [Replit](https://replit.com/@nktnet1/sync-request-curl-example#index.js).

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
  proxy: 'http://your-proxy-url:port',
  proxyAuth: {
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
| `options` | \{ `proxy?`: `string`; `proxyAuth?`: \{ `username`: `string`; `password`: `string`; \}; `rejectUnauthorized?`: `boolean`; `caFile?`: `string`; `localAddress?`: `string`; `localInterface?`: `string`; `tcpKeepAlive?`: \| `boolean` \| \{ `idleSeconds?`: `number`; `intervalSeconds?`: `number`; \}; `cacheNamespace?`: `string`; `headers?`: \{ \[`key`: `string`\]: `string` \| `string`[] \| `undefined`; \}; `qs?`: \{ \[`key`: `string`\]: `unknown`; \}; `json?`: `JsonLikeValue`; `body?`: `string` \| `Buffer`\<`ArrayBufferLike`\>; `form?`: [`FormData`](#formdata); `timeout?`: `number`; `overallTimeout?`: `number`; `socketTimeout?`: `number`; `followRedirects?`: `boolean`; `maxRedirects?`: `number`; `allowRedirectHeaders?`: `string`[]; `gzip?`: `boolean`; `cache?`: `"file"` \| `"memory"`; `agent?`: `boolean` \| `Agent`; `retry?`: `boolean` \| [`RetryFunction`](#retryfunction); `retryDelay?`: `number` \| [`RetryDelayFunction`](#retrydelayfunction); `maxRetries?`: `number`; \} | Request, transport, redirect, retry, and cache options. |
| `options.proxy?` | `string` | Explicit HTTP/HTTPS proxy origin URL. Ambient proxy variables are ignored. |
| `options.proxyAuth?` | \{ `username`: `string`; `password`: `string`; \} | Basic proxy credentials. Requires `proxy` and overrides credentials in its URL. |
| `options.proxyAuth.username` | `string` | Proxy username. |
| `options.proxyAuth.password` | `string` | Proxy password. |
| `options.rejectUnauthorized?` | `boolean` | Verify the origin certificate chain and hostname. Defaults to `true`. |
| `options.caFile?` | `string` | PEM CA bundle path for origin TLS verification. |
| `options.localAddress?` | `string` | Source IPv4/IPv6 address. Hostnames are rejected. |
| `options.localInterface?` | `string` | Source interface name. Mutually exclusive with `localAddress`. |
| `options.tcpKeepAlive?` | \| `boolean` \| \{ `idleSeconds?`: `number`; `intervalSeconds?`: `number`; \} | Enable TCP keepalive, optionally with idle and interval controls. |
| `options.cacheNamespace?` | `string` | Private cache identity. Defaults to `process.cwd()`. |
| `options.headers?` | \{ \[`key`: `string`\]: `string` \| `string`[] \| `undefined`; \} | Node-style request headers. |
| `options.qs?` | \{ \[`key`: `string`\]: `unknown`; \} | Query values merged with any existing query string. |
| `options.json?` | `JsonLikeValue` | JSON-compatible request body. Adds `application/json` when needed. |
| `options.body?` | `string` \| `Buffer`\<`ArrayBufferLike`\> | Raw string or `Buffer` request body. |
| `options.form?` | [`FormData`](#formdata) | Synchronous multipart/form-data body. |
| `options.timeout?` | `number` | Per-network-attempt timeout in milliseconds. `0` disables it. |
| `options.overallTimeout?` | `number` | Complete-operation deadline in milliseconds. `0` disables it. |
| `options.socketTimeout?` | `number` | Socket inactivity timeout in milliseconds. `0` disables it. |
| `options.followRedirects?` | `boolean` | Follow redirects automatically. Defaults to `true`. |
| `options.maxRedirects?` | `number` | Maximum redirects to follow. Negative or non-finite values mean no limit. |
| `options.allowRedirectHeaders?` | `string`[] | Caller headers allowed to be forwarded to redirect hops. |
| `options.gzip?` | `boolean` | Transparently decompress gzip/deflate responses. Defaults to enabled. |
| `options.cache?` | `"file"` \| `"memory"` | Enable the private HTTP-aware cache in file or memory storage. |
| `options.agent?` | `boolean` \| `Agent` | `sync-request` boolean agent option, or a keep-alive Node `Agent`. |
| `options.retry?` | `boolean` \| [`RetryFunction`](#retryfunction) | Retry GET requests, or provide a callback to decide per attempt. |
| `options.retryDelay?` | `number` \| [`RetryDelayFunction`](#retrydelayfunction) | Retry delay in milliseconds, or a callback returning the delay. |
| `options.maxRetries?` | `number` | Maximum retry count. Defaults to 5 when retries are enabled. |

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

Options accepted by `request`.

Payload precedence is `form`, then `json`, then `body` when more than one is
supplied.

##### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-proxy"></a> `proxy?` | `string` | Explicit HTTP/HTTPS proxy origin URL. Ambient proxy variables are ignored. |
| <a id="property-proxyauth"></a> `proxyAuth?` | \{ `username`: `string`; `password`: `string`; \} | Basic proxy credentials. Requires `proxy` and overrides credentials in its URL. |
| `proxyAuth.username` | `string` | Proxy username. |
| `proxyAuth.password` | `string` | Proxy password. |
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
| <a id="property-url-1"></a> `url` | `string` | Final effective URL for the completed attempt. |
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

Version 5 targets the observable Node.js `sync-request` API while keeping the in-process libcurl transport. The detailed compatibility decisions and rationale are tracked in [ROADMAP.md](ROADMAP.md); the practical differences are summarised here.

<a id="differences-from-sync-request-intentional-additions"></a>
### 4.1. Intentional additions

- `Response#getJSON()` is retained as a convenience helper.
- `cache: "memory"` is available in addition to `sync-request`'s file-cache surface.
- `retry` and `retryDelay` may be callbacks for synchronous policy decisions.
- A real keep-alive Node `Agent` may be supplied for additive connection-pool reuse; the upstream-compatible boolean `agent` values remain accepted.
- `overallTimeout` provides a complete-operation deadline in addition to the per-attempt `timeout` and inactivity `socketTimeout` controls.
- Explicit high-level proxy, TLS, source binding, and TCP keepalive options replace the old node-libcurl-specific callback surface.

<a id="differences-from-sync-request-intentional-behavioural-differences"></a>
### 4.2. Intentional behavioural differences

- The package is Node-only; browser synchronous-XHR support is not a v5 target.
- Explicit bodies on `GET`, `DELETE`, and `HEAD` remain supported, and falsy JSON values such as `false`, `0`, `""`, and `null` are valid payloads.
- Invalid or ambiguous HTTP framing is rejected instead of forwarding known-bad `Content-Length` / `Transfer-Encoding` combinations.
- Only absolute `http:` and `https:` targets are accepted. Ambient proxy environment variables are ignored; proxy routing is explicit through `proxy`.
- Caller-supplied `Authorization` remains authoritative over URL credentials, and caller-supplied `Accept-Encoding` is preserved exactly.
- Redirects preserve method and payload for 307/308, rather than reproducing the upstream wrapper bug that can rewrite body-bearing requests to GET.
- Query merging preserves additional literal `?` and `#` delimiters that upstream can truncate while splitting URLs.
- Cache handling intentionally keeps `no-store` precedence, updates `Age` on hits, isolates mutable cached headers, and treats recoverable cache read failures as misses instead of reproducing upstream cache quirks.
- Where supported by the bundled/system libcurl, HTTPS requests may negotiate HTTP/2 instead of being forced to HTTP/1.1 solely for Node `http` parity.

<a id="differences-from-sync-request-out-of-scope"></a>
### 4.3. Out of scope

The synchronous buffered API does not attempt to expose lower-level asynchronous or stream-shaped internals that `sync-request` itself does not forward cleanly: stream request bodies, callback cache implementations and cache-policy hooks, `http-basic` duplex behaviour, `ignoreFailedInvalidation`, or the internal `fromCache` / `fromNotModified` flags.

<a id="differences-from-sync-request-migrating-from-v4"></a>
### 4.4. Migrating from v4

The public node-libcurl-style API has been removed. Replace `setEasyOptions`, `Easy`, and `CurlOption` with the high-level options documented above: `proxy` / `proxyAuth`, `rejectUnauthorized` / `caFile`, `localAddress` / `localInterface`, and `tcpKeepAlive`. Replace the old `formData` / `HttpPostField` request shape with `FormData` passed through `form`. `CurlError` remains available for raw libcurl transport failures.

<a id="license"></a>
## 5. License

[MIT License](LICENSE)

<a id="compatibility"></a>
## 6. Compatibility

`sync-request-curl` supports Node.js 16.17.0 and newer at runtime. The native addon targets Node-API v8, so a prebuilt addon is tied to its operating system, CPU architecture, and C runtime, but not to a specific Node.js major version. The same prebuilt binary can be reused by Node.js releases that support Node-API v8.

Repository build and release automation runs on newer Node.js versions independently of the published runtime requirement. Package consumers do not execute those TypeScript build scripts or compile the native addon.

The published package does not download or compile native code during installation. Each release declares platform-specific optional packages, so the package manager installs only the native binary compatible with the current operating system, CPU architecture, and Linux C runtime. If optional dependencies are disabled or a matching package is unavailable, loading fails with an explicit error instead of falling back to `node-gyp`.

<a id="compatibility-windows"></a>
### 6.1. Windows

Prebuilt addons are prepared for x64 and arm64 Windows. No Visual Studio, Python, Rust, CMake, vcpkg, or node-gyp installation is required by package consumers.

Requests may still fail with Libcurl Error 60 (`CURLE_PEER_FAILED_VERIFICATION`) when the peer certificate cannot be verified. `rejectUnauthorized: false` disables origin certificate and hostname verification and should only be used when that trade-off is intentional.

<a id="compatibility-macos"></a>
### 6.2. macOS

Prebuilt addons are prepared for Apple Silicon (`arm64`) and Intel (`x64`) macOS. No Xcode command-line tools or local libcurl installation is required by package consumers.

<a id="compatibility-linux"></a>
### 6.3. Linux

Prebuilt addons are prepared for both glibc and musl on x64 and arm64 Linux. This covers the common Debian, Ubuntu, Arch, and Alpine variants without compiling native code during installation. GNU/Linux release binaries are built against a GLIBC 2.31 baseline, while Alpine binaries are built and tested in a musl environment.

<a id="caveats"></a>
## 7. Caveats

See [sync-request](https://www.npmjs.com/package/sync-request) for the original documentation. Version 5 targets its observable Node.js API rather than every lower-level `then-request` / `http-basic` internal, and intentionally keeps transport-specific native details behind high-level request options. See [Differences from `sync-request`](#differences-from-sync-request) for the compatibility boundaries.

**sync-request-curl** was developed to improve performance with sending synchronous requests in NodeJS. It is also free from the sync-request bug which leaves an orphaned sync-rpc process, resulting in a [leaked handle being detected in Jest](https://github.com/ForbesLindesay/sync-request/issues/129).

**sync-request-curl** was designed to work with UNIX-like systems for UNSW students enrolled in [COMP1531 Software Engineering Fundamentals](https://webcms3.cse.unsw.edu.au/COMP1531/23T2/outline). The native distribution targets glibc- and musl-based Linux, Windows, and macOS on the architectures listed in the compatibility section.

Please note that this library's primary goal is to simplify the learning of JavaScript for novice programmers, hence its synchronous nature. However, we recommend to **always use an [asynchronous alternative](https://blog.appsignal.com/2024/09/11/top-5-http-request-libraries-for-nodejs.html)** where possible.
