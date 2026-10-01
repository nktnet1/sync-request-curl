<!-- This file is auto-generated using TypeDoc. Do not edit README.md directly. -->

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

A high-performance Node.js alternative to [sync-request](https://github.com/ForbesLindesay/sync-request) for making synchronous web requests.

</div>

---

- [1. Installation](#installation)
- [2. Usage](#usage)
- [3. API reference](#api-reference)
- [4. Differences from sync-request](#differences-from-sync-request)
  - [4.1. Additions](#differences-from-sync-request-additions)
  - [4.2. Behavioural differences](#differences-from-sync-request-behavioural-differences)
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
`then-request`: `getHeaders()`, `getBoundary()`, `setBoundary()`, `getBuffer()`,
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
| `method` | [`HttpVerb`](#httpverb) | Recognised HTTP method. Matching is case-insensitive; `CONNECT` is rejected. |
| `url` | `string` \| [`URL`](https://nodejs.org/api/url.html#class-url) | Absolute `http:` or `https:` URL, provided as a string or [`URL`](https://nodejs.org/api/url.html#class-url). |
| `options` | [`Options`](#options) | Request, transport, redirect, retry, and cache options. |

##### Returns

[`Response`](#response)

The buffered response after redirects and retries complete.

***

#### HttpVerb

```ts
type HttpVerb =
  | "GET"
  | "get"
  | "HEAD"
  | "head"
  | "POST"
  | "post"
  | "PUT"
  | "put"
  | "DELETE"
  | "delete"
  | "CONNECT"
  | "connect"
  | "OPTIONS"
  | "options"
  | "TRACE"
  | "trace"
  | "PATCH"
  | "patch"
  | "PROPFIND"
  | "propfind";
```

Recognised HTTP methods. Input is case-insensitive and is normalised to
uppercase before transport.

`CONNECT` is retained in the union for source compatibility with
`sync-request`, but `request()` rejects it because the buffered API cannot
expose the tunnel socket created by a successful CONNECT response.

***

#### Options

```ts
type Options = {
  proxy?: ProxyOptions;
  httpVersion?: "auto"
     | "2"
     | "3"
     | "1.0"
     | "1.1"
     | "2-tls"
     | "2-prior-knowledge"
     | "3-only";
  rejectUnauthorized?: boolean;
  caFile?: string;
  localAddress?: string;
  localInterface?: string;
  family?: 0 | 4 | 6;
  tcpKeepAlive?: boolean
     | {
     idleSeconds?: number;
     intervalSeconds?: number;
   };
  cacheNamespace?: string;
  headers?: Headers;
  qs?: {
   [key: string]: unknown;
  };
  json?: JsonLike;
  body?: string | Buffer<ArrayBufferLike>;
  form?: FormData;
  timeout?: number;
  connectTimeout?: number;
  overallTimeout?: number;
  socketTimeout?: number;
  followRedirects?: boolean;
  maxRedirects?: number;
  allowRedirectHeaders?: string[];
  gzip?: boolean;
  cache?: "file" | "memory";
  isMatch?: CacheIsMatchFunction;
  isExpired?: CacheIsExpiredFunction;
  canCache?: CacheCanCacheFunction;
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
| <a id="property-proxy"></a> `proxy?` | [`ProxyOptions`](#proxyoptions) | Explicit HTTP/HTTPS proxy origin URL. Ambient proxy variables are ignored. Defaults to no proxy. |
| <a id="property-httpversion"></a> `httpVersion?` | \| `"auto"` \| `"2"` \| `"3"` \| `"1.0"` \| `"1.1"` \| `"2-tls"` \| `"2-prior-knowledge"` \| `"3-only"` | HTTP protocol preference. Defaults to `"auto"`. HTTP/3 values require an HTTP/3-capable linked libcurl build. |
| <a id="property-rejectunauthorized"></a> `rejectUnauthorized?` | `boolean` | Verify the origin certificate chain and hostname. Defaults to `true`. |
| <a id="property-cafile"></a> `caFile?` | `string` | PEM CA bundle path for origin TLS verification. |
| <a id="property-localaddress"></a> `localAddress?` | `string` | Source IPv4/IPv6 address. Hostnames are rejected. |
| <a id="property-localinterface"></a> `localInterface?` | `string` | Source interface name. Mutually exclusive with `localAddress`. |
| <a id="property-family"></a> `family?` | `0` \| `4` \| `6` | IP address family used when resolving hostnames. `0` (default) allows either family, `4` restricts resolution to IPv4, and `6` to IPv6. |
| <a id="property-tcpkeepalive"></a> `tcpKeepAlive?` | \| `boolean` \| \{ `idleSeconds?`: `number`; `intervalSeconds?`: `number`; \} | Enable TCP keepalive, optionally with idle and interval controls. Defaults to `false`. |
| <a id="property-cachenamespace"></a> `cacheNamespace?` | `string` | Private cache identity. Defaults to `process.cwd()`. |
| <a id="property-headers-1"></a> `headers?` | [`Headers`](#headers) | Node-style request headers. |
| <a id="property-qs"></a> `qs?` | \{ \[`key`: `string`\]: `unknown`; \} | Query values merged with any existing query string. |
| <a id="property-json"></a> `json?` | [`JsonLike`](#jsonlike) | JSON-compatible request body. Adds `application/json` when needed. |
| <a id="property-body-1"></a> `body?` | `string` \| [`Buffer`](https://nodejs.org/api/buffer.html#class-buffer)\<`ArrayBufferLike`\> | Raw string or [`Buffer`](https://nodejs.org/api/buffer.html#class-buffer) request body. |
| <a id="property-form"></a> `form?` | [`FormData`](#formdata) | Synchronous multipart/form-data body. |
| <a id="property-timeout"></a> `timeout?` | `number` | Maximum time to wait for response headers in milliseconds. Defaults to `0`, which disables it. |
| <a id="property-connecttimeout"></a> `connectTimeout?` | `number` | Maximum time allowed for connection establishment in milliseconds. This includes DNS lookup, TCP connection, and TLS/protocol handshakes. Defaults to `0`, which uses libcurl's default connection timeout. |
| <a id="property-overalltimeout"></a> `overallTimeout?` | `number` | Complete-operation deadline in milliseconds. Defaults to `0`, which disables it. |
| <a id="property-sockettimeout"></a> `socketTimeout?` | `number` | Socket inactivity timeout in milliseconds. Defaults to `0`, which disables it. |
| <a id="property-followredirects"></a> `followRedirects?` | `boolean` | Follow redirects automatically. Defaults to `true`. |
| <a id="property-maxredirects"></a> `maxRedirects?` | `number` | Maximum redirects to follow. Defaults to no limit. Negative values and infinities also mean no limit; `NaN` is invalid. |
| <a id="property-allowredirectheaders"></a> `allowRedirectHeaders?` | `string`[] | Caller headers allowed to be forwarded to redirect hops. Defaults to none. |
| <a id="property-gzip"></a> `gzip?` | `boolean` | Transparently decompress gzip/deflate responses. Defaults to `true`. |
| <a id="property-cache"></a> `cache?` | `"file"` \| `"memory"` | Enable the private HTTP-aware cache in file or memory storage. Defaults to disabled. |
| <a id="property-ismatch"></a> `isMatch?` | [`CacheIsMatchFunction`](#cacheismatchfunction) | Override whether a stored cache variant matches the outgoing request. When caching is enabled, defaults to the built-in `Vary` comparison. |
| <a id="property-isexpired"></a> `isExpired?` | [`CacheIsExpiredFunction`](#cacheisexpiredfunction) | Override whether a matched cached response is expired. When caching is enabled, defaults to the built-in freshness calculation. |
| <a id="property-cancache"></a> `canCache?` | [`CacheCanCacheFunction`](#cachecancachefunction) | Override whether a completed origin response may be stored. When caching is enabled, defaults to the built-in response cacheability rules. |
| <a id="property-agent"></a> `agent?` | `boolean` \| [`Agent`](https://nodejs.org/api/http.html#class-httpagent) | `sync-request` boolean agent option, or a keep-alive Node [`Agent`](https://nodejs.org/api/http.html#class-httpagent) for connection reuse. Defaults to the standard connection behaviour without a dedicated persistent pool. |
| <a id="property-retry"></a> `retry?` | `boolean` \| [`RetryFunction`](#retryfunction) | Retry GET requests, or provide a callback to decide per attempt. Defaults to disabled. |
| <a id="property-retrydelay"></a> `retryDelay?` | `number` \| [`RetryDelayFunction`](#retrydelayfunction) | Retry delay in milliseconds, or a callback returning the delay. Defaults to 200 milliseconds when retries are enabled. |
| <a id="property-maxretries"></a> `maxRetries?` | `number` | Maximum retry count. Defaults to 5 when retries are enabled. |

***

#### Headers

```ts
type Headers = IncomingHttpHeaders;
```

HTTP header map used by `then-request`.

This is an alias of Node.js' [`IncomingHttpHeaders`](https://nodejs.org/api/http.html#messageheaders), exposed under
the historical `then-request` name so consumers do not need to import Node's
type directly.

***

#### JsonPrimitive

```ts
type JsonPrimitive = string | number | boolean | null;
```

Primitive JSON values accepted in request bodies.

***

#### NestedJsonLike

```ts
type NestedJsonLike =
  | JsonLike
  | undefined
  | {
  toJSON: () => NestedJsonLike;
};
```

Values accepted when nested inside JSON request bodies.

***

#### JsonLike

```ts
type JsonLike =
  | JsonPrimitive
  | readonly NestedJsonLike[]
  | {
[key: string]: NestedJsonLike;
}
  | {
  toJSON: () => JsonLike;
};
```

Values accepted for JSON request bodies.

This intentionally follows practical `JSON.stringify()` inputs rather than
only strict JSON syntax. `undefined` is allowed inside objects and arrays,
and objects with `toJSON()` (for example `Date`) are supported.

***

#### HttpVersion

```ts
type HttpVersion =
  | "auto"
  | "1.0"
  | "1.1"
  | "2"
  | "2-tls"
  | "2-prior-knowledge"
  | "3"
  | "3-only";
```

HTTP protocol preference passed to libcurl.

HTTP/3 values require the linked libcurl build to include HTTP/3 support.

***

#### IpFamily

```ts
type IpFamily = 0 | 4 | 6;
```

IP address family used when resolving hostnames.

`0` allows either IPv4 or IPv6, `4` restricts resolution to IPv4, and `6`
restricts resolution to IPv6.

***

#### ProxyOptions

An explicit HTTP/HTTPS proxy and optional Basic credentials.

##### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-url-2"></a> `url` | `string` | HTTP/HTTPS proxy origin URL. May contain URL-encoded credentials. |
| <a id="property-username"></a> `username?` | `string` | Overrides both URL credentials. An omitted password becomes an empty string. |
| <a id="property-password"></a> `password?` | `string` | Proxy password. Requires an explicit username. Defaults to an empty string. |

***

#### RetryResponse

Response shape passed to retry policy callbacks.

`getBody()` follows the same status handling as a normal response. Retry
callbacks receive this buffered response before the next attempt begins.

##### Extended by

- [`CachePolicyResponse`](#cachepolicyresponse)

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
| `encoding` | [`BufferEncoding`](#bufferencoding) |

###### Returns

`string`

###### Call Signature

```ts
getBody(): Buffer;
```

Read the response body as a [`Buffer`](https://nodejs.org/api/buffer.html#class-buffer).

###### Returns

[`Buffer`](https://nodejs.org/api/buffer.html#class-buffer)

##### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-statuscode-2"></a> `statusCode` | `number` | HTTP response status code. |
| <a id="property-headers-3"></a> `headers` | [`Headers`](#headers) | Node-style response headers with lowercase keys. |
| <a id="property-url-3"></a> `url` | `string` | Final effective URL for the completed attempt. |
| <a id="property-body-3"></a> `body` | [`Buffer`](https://nodejs.org/api/buffer.html#class-buffer) | Buffered response body. |

***

#### CachedResponse

Buffered cached response passed to cache policy callbacks.

The body, headers, and request headers are defensive copies. Mutating them
does not modify the stored cache entry.

##### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-statuscode-3"></a> `statusCode` | `number` | Cached HTTP response status code. |
| <a id="property-headers-4"></a> `headers` | [`Headers`](#headers) | Cached Node-style response headers with lowercase keys. |
| <a id="property-body-4"></a> `body` | [`Buffer`](https://nodejs.org/api/buffer.html#class-buffer) | Buffered cached response body. |
| <a id="property-requestheaders"></a> `requestHeaders` | [`Headers`](#headers) | Request headers stored with this cache variant. |
| <a id="property-requesttimestamp"></a> `requestTimestamp` | `number` | Timestamp when the cached request started, in Unix milliseconds. |

***

#### CachePolicyResponse

Buffered origin response passed to `canCache`.

This is the normal public response shape for the completed GET request.

##### Extends

- [`RetryResponse`](#retryresponse)

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
| `encoding` | [`BufferEncoding`](#bufferencoding) |

###### Returns

`string`

###### Inherited from

[`RetryResponse`](#retryresponse).[`getBody`](#getbody-1)

###### Call Signature

```ts
getBody(): Buffer;
```

Read the response body as a [`Buffer`](https://nodejs.org/api/buffer.html#class-buffer).

###### Returns

[`Buffer`](https://nodejs.org/api/buffer.html#class-buffer)

###### Inherited from

[`RetryResponse`](#retryresponse).[`getBody`](#getbody-1)

###### getJSON()

```ts
getJSON<T>(encoding?): T;
```

Parse the buffered response body as JSON.

###### Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `T` | `any` |

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `encoding?` | [`BufferEncoding`](#bufferencoding) |

###### Returns

`T`

##### Properties

| Property | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="property-statuscode-4"></a> `statusCode` | `number` | HTTP response status code. | [`RetryResponse`](#retryresponse).[`statusCode`](#property-statuscode-2) |
| <a id="property-headers-5"></a> `headers` | [`Headers`](#headers) | Node-style response headers with lowercase keys. | [`RetryResponse`](#retryresponse).[`headers`](#property-headers-3) |
| <a id="property-url-4"></a> `url` | `string` | Final effective URL for the completed attempt. | [`RetryResponse`](#retryresponse).[`url`](#property-url-3) |
| <a id="property-body-5"></a> `body` | [`Buffer`](https://nodejs.org/api/buffer.html#class-buffer) | Buffered response body. | [`RetryResponse`](#retryresponse).[`body`](#property-body-3) |

***

#### CacheIsMatchFunction

```ts
type CacheIsMatchFunction = (requestHeaders, cachedResponse, defaultValue) => boolean;
```

Override whether a stored cache variant matches the outgoing request.

`defaultValue` is the built-in `Vary` comparison result.

##### Parameters

| Parameter | Type |
| ------ | ------ |
| `requestHeaders` | [`Headers`](#headers) |
| `cachedResponse` | [`CachedResponse`](#cachedresponse) |
| `defaultValue` | `boolean` |

##### Returns

`boolean`

***

#### CacheIsExpiredFunction

```ts
type CacheIsExpiredFunction = (cachedResponse, defaultValue) => boolean;
```

Override whether a matched cached response is expired.

`defaultValue` is the result of the built-in freshness calculation.

##### Parameters

| Parameter | Type |
| ------ | ------ |
| `cachedResponse` | [`CachedResponse`](#cachedresponse) |
| `defaultValue` | `boolean` |

##### Returns

`boolean`

***

#### CacheCanCacheFunction

```ts
type CacheCanCacheFunction = (response, defaultValue) => boolean;
```

Override whether a completed origin response may be stored in the cache.

`defaultValue` is the built-in response cacheability result. Request-side
`Cache-Control: no-store` still disables storage before this callback runs.

##### Parameters

| Parameter | Type |
| ------ | ------ |
| `response` | [`CachePolicyResponse`](#cachepolicyresponse) |
| `defaultValue` | `boolean` |

##### Returns

`boolean`

***

#### RetryFunction

```ts
type RetryFunction = (error, response, attemptNumber) => boolean;
```

Decide whether a GET request should be retried after an error or response.

`attemptNumber` starts at 1 for the first completed attempt. Transport
failures are passed as `CurlError` instances; response parser failures are
passed as `RequestError` instances.

##### Parameters

| Parameter | Type |
| ------ | ------ |
| `error` | [`CurlError`](#curlerror) \| [`RequestError`](#requesterror) \| `null` |
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

`attemptNumber` starts at 1 for the first completed attempt. Transport
failures are passed as `CurlError` instances; response parser failures are
passed as `RequestError` instances.

##### Parameters

| Parameter | Type |
| ------ | ------ |
| `error` | [`CurlError`](#curlerror) \| [`RequestError`](#requesterror) \| `null` |
| `response` | [`RetryResponse`](#retryresponse) \| `undefined` |
| `attemptNumber` | `number` |

##### Returns

`number`

### Response

#### GetBody

```ts
type GetBody = {
  <Encoding>(encoding): string;
  (): Buffer;
};
```

Read the current response body.

Calling without an encoding returns the [`Buffer`](https://nodejs.org/api/buffer.html#class-buffer). Passing an encoding returns
a string. A response with `statusCode >= 300` throws `ResponseError`.

##### Call Signature

```ts
<Encoding>(encoding): string;
```

###### Type Parameters

| Type Parameter |
| ------ |
| `Encoding` *extends* [`BufferEncoding`](#bufferencoding) |

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

[`Buffer`](https://nodejs.org/api/buffer.html#class-buffer)

***

#### GetJSON

```ts
type GetJSON = <T>(encoding?) => T;
```

Parse the current response body as JSON.

Unlike `GetBody`, this helper does not reject HTTP error status codes.
It only throws if the body cannot be parsed as JSON.
Defaults to `any` for v4 compatibility. Pass an explicit type argument to
describe the expected result; this does not perform runtime validation.

##### Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `T` | `any` |

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

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-iserror"></a> `isError` | () => `boolean` | Return whether the response represents an HTTP error. |
| <a id="property-getbody"></a> `getBody` | [`GetBody`](#getbody) | Read the response body and throw `ResponseError` for HTTP status >= 300. |
| <a id="property-getjson"></a> `getJSON` | [`GetJSON`](#getjson) | Parse the response body as JSON without applying HTTP status handling. |
| <a id="property-statuscode-1"></a> `statusCode` | `number` | HTTP response status code. |
| <a id="property-headers-2"></a> `headers` | [`Headers`](#headers) | Node-style response headers with lowercase keys. |
| <a id="property-url-1"></a> `url` | `string` | Final effective URL after query handling and redirects. |
| <a id="property-body-2"></a> `body` | [`Buffer`](https://nodejs.org/api/buffer.html#class-buffer)\<`ArrayBufferLike`\> | Mutable buffered response body. |

***

#### BufferEncoding

```ts
type BufferEncoding =
  | "base64"
  | "ascii"
  | "utf8"
  | "utf-8"
  | "utf16le"
  | "utf-16le"
  | "ucs2"
  | "ucs-2"
  | "base64url"
  | "latin1"
  | "binary"
  | "hex";
```

Buffer encodings accepted by response body helpers.

### Multipart

#### FormDataEntry

One multipart entry accepted by `FormData`.

##### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-contenttype"></a> `contentType?` | `string` | Optional media type override. |
| <a id="property-knownlength"></a> `knownLength?` | `number` | Accepted for `form-data` append-option compatibility. |
| <a id="property-header"></a> `header?` | `string` | Optional raw multipart header that replaces generated part headers. |
| <a id="property-key"></a> `key` | `string` | Multipart field name. |
| <a id="property-value"></a> `value` | `string` \| `number` \| `boolean` \| [`Buffer`](https://nodejs.org/api/buffer.html#class-buffer)\<`ArrayBufferLike`\> \| [`Blob`](https://nodejs.org/api/buffer.html#class-blob) | Synchronously materialisable multipart field value. |
| <a id="property-filename"></a> `fileName?` | `string` | Optional file name. Path components are stripped before sending. |

***

#### FormData

Synchronous multipart/form-data builder compatible with the Node.js
`FormData` surface exposed by `then-request`.

Stream-valued parts and callback/stream methods from the `form-data` package
are intentionally omitted because this package is synchronous-only.

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
   options?
): void;
```

Append a synchronously materialisable multipart field.

Numbers and booleans are converted to strings. The third argument may be a
filename string or the synchronous subset of `form-data` append options.
A custom `header` is serialized verbatim and replaces the generated
boundary and part headers, matching Node's `form-data` behavior. Local
path components are stripped from generated filenames before sending.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `key` | `string` |
| `value` | `string` \| `number` \| `boolean` \| [`Buffer`](https://nodejs.org/api/buffer.html#class-buffer)\<`ArrayBufferLike`\> \| [`Blob`](https://nodejs.org/api/buffer.html#class-blob) |
| `options?` | \| `string` \| \{ `filename?`: `string`; `contentType?`: `string`; `knownLength?`: `number`; `header?`: `string`; \} |

###### Returns

`void`

###### getHeaders()

###### Call Signature

```ts
getHeaders(): IncomingHttpHeaders & {
  content-type: string;
};
```

Return multipart request headers, merged with optional caller headers.

###### Returns

[`IncomingHttpHeaders`](https://nodejs.org/api/http.html#messageheaders) & \{
  `content-type`: `string`;
\}

###### Call Signature

```ts
getHeaders(userHeaders): Headers;
```

Return multipart request headers, merged with optional caller headers.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `userHeaders` | [`Headers`](#headers) |

###### Returns

[`Headers`](#headers)

###### getBoundary()

```ts
getBoundary(): string;
```

Return the boundary used to serialize this form.

###### Returns

`string`

###### setBoundary()

```ts
setBoundary(boundary): void;
```

Set the multipart boundary used by headers and serialization.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `boundary` | `string` |

###### Returns

`void`

###### getBuffer()

```ts
getBuffer(): Buffer;
```

Serialize the complete multipart payload synchronously.

###### Returns

[`Buffer`](https://nodejs.org/api/buffer.html#class-buffer)

###### getLengthSync()

```ts
getLengthSync(): number;
```

Return the exact byte length of `getBuffer()`.

###### Returns

`number`

###### hasKnownLength()

```ts
hasKnownLength(): boolean;
```

All supported field values have a synchronously known length.

###### Returns

`boolean`

###### toString()

```ts
toString(): string;
```

Match the identity string returned by Node's `form-data` package.

###### Returns

`string`

### Errors

#### RequestErrorCode

```ts
type RequestErrorCode = "ETIMEDOUT" | "ERR_TOO_MANY_REDIRECTS" | "ERR_REQUEST_FAILED";
```

Stable transport-neutral error codes emitted by the TypeScript request layer.

***

#### CurlError

Raw libcurl transport failure.

The numeric `code` is retained for compatibility with earlier
`sync-request-curl` releases and maps to libcurl's documented error codes.

##### Extends

- [`Error`](https://nodejs.org/api/errors.html#class-error)

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

- [`Error`](https://nodejs.org/api/errors.html#class-error)

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
| `code` | [`RequestErrorCode`](#requesterrorcode) |
| `message` | `string` |
| `options?` | [`ErrorOptions`](https://nodejs.org/api/errors.html#new-errormessage-options) |

###### Returns

[`RequestError`](#requesterror)

###### Overrides

```ts
Error.constructor
```

##### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-code-1"></a> `code` | `readonly` | [`RequestErrorCode`](#requesterrorcode) | Stable transport-neutral request error code. |

***

#### ResponseError

HTTP status error thrown by `response.getBody()` for status codes >= 300.

The status, headers, body, and response URL that produced the error remain
available on the error object.

##### Extends

- [`Error`](https://nodejs.org/api/errors.html#class-error)

##### Constructors

###### Constructor

```ts
new ResponseError(
   statusCode,
   headers,
   body,
   encoding?,
   url?
): ResponseError;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `statusCode` | `number` |
| `headers` | [`Headers`](#headers) |
| `body` | [`Buffer`](https://nodejs.org/api/buffer.html#class-buffer) |
| `encoding?` | [`BufferEncoding`](#bufferencoding) |
| `url?` | `string` |

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
| <a id="property-headers"></a> `headers` | `readonly` | [`Headers`](#headers) | Response headers returned by the server. |
| <a id="property-body"></a> `body` | `readonly` | [`Buffer`](https://nodejs.org/api/buffer.html#class-buffer) | Buffered response body returned by the server. |
| <a id="property-url"></a> `url?` | `readonly` | `string` | Final response URL when the error came from `Response#getBody()`. |

<a id="differences-from-sync-request"></a>
## 4. Differences from sync-request

<a id="differences-from-sync-request-additions"></a>
### 4.1. Additions

- `Response#getJSON()` is available as a convenience helper.
- `cache: "memory"` is available as an alternative to the file cache.
- `isMatch`, `isExpired`, and `canCache` expose the synchronous cache-policy
  hooks from [`http-basic`](https://github.com/ForbesLindesay/http-basic).
  Callback/stream-based custom cache implementations remain out of scope; use
  the built-in `"file"` or `"memory"` cache.
- `retry` and `retryDelay` can be callbacks when you need to decide retry
  behaviour at runtime. Transport failures passed to these callbacks are
  `CurlError` instances with numeric libcurl error codes, while response parser
  failures are `RequestError` instances rather than Node `ErrnoException` errors.
- `agent` still accepts the boolean values supported by
  [`sync-request`](https://github.com/ForbesLindesay/sync-request),
  and can also take a keep-alive Node `Agent` for connection reuse.
- `overallTimeout` sets a deadline for the whole operation, alongside the
  response-header `timeout`, connection-establishment `connectTimeout`, and
  inactivity `socketTimeout` options.
- TLS, local network binding, and TCP keepalive have dedicated options.
- `httpVersion` can request HTTP/1.0, HTTP/1.1, HTTP/2, HTTP/2 over TLS,
  HTTP/2 prior knowledge, HTTP/3, or HTTP/3-only behaviour. HTTP/3 requires
  the linked libcurl build to include HTTP/3 support.
- `family` can leave address-family selection automatic or restrict hostname
  resolution to IPv4 or IPv6.

<a id="differences-from-sync-request-behavioural-differences"></a>
### 4.2. Behavioural differences

- [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html) defines request
  framing independently of the method, so request content is permitted on
  `GET`, `DELETE`, and `HEAD`. The standard also notes that this content has no
  generally defined semantics and may be rejected by some implementations.
- Falsy JSON values such as `false`, `0`, `""`, and `null` are valid payloads.
- `Response#getBody()` throws `ResponseError` for HTTP status codes >= 300. It
  still extends `Error` and exposes `statusCode`, `headers`, and `body`, but its
  `name` is `"ResponseError"` rather than sync-request's default `"Error"`.
- Invalid HTTP framing is rejected rather than sending conflicting
  `Content-Length` and `Transfer-Encoding` headers.
- Obsolete HTTP/1 response line folding is normalised to spaces as required for
  user agents by [RFC 9112](https://www.rfc-editor.org/rfc/rfc9112.html).
  `sync-request` inherits Node's stricter parser, which can reject those
  responses instead.
- `CONNECT` is rejected explicitly. Although `sync-request` accepts it at the
  type level, its underlying buffered request stack does not complete a
  successful CONNECT tunnel response.
- libcurl applies RFC 3986 URL normalisation, including removal of `.` and `..`
  path segments. `Response#url` reports libcurl's effective URL, so it can
  reflect that normalisation instead of preserving the caller's literal URL.
- An explicit `Authorization` header takes precedence over credentials in the
  URL, and a caller-supplied `Accept-Encoding` header is left unchanged.
- 307 and 308 redirects preserve the request method and body.
  [`sync-request`](https://github.com/ForbesLindesay/sync-request)
  can rewrite some body-bearing redirects to `GET`.
- A redirect response without a `Location` header is returned unchanged rather
  than being converted into an exception.
  [RFC 9110's redirection semantics](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4)
  define automatic redirection in terms of a provided `Location` value. This
  intentionally differs from `http-basic`, which throws when a redirect status
  has no redirect target.
- Query merging preserves additional literal `?` and `#` delimiters that
  [`sync-request`](https://github.com/ForbesLindesay/sync-request) can truncate
  while splitting URLs.
- Default cache handling is stricter: `no-store` takes precedence, `Age` is
  updated on cache hits, cached headers are isolated from mutation, and
  recoverable cache-read errors are treated as misses.
- HTTPS requests can negotiate HTTP/2 automatically when supported.

<a id="license"></a>
## 5. License

[MIT](LICENSE)

<a id="compatibility"></a>
## 6. Compatibility

`sync-request-curl` supports Node.js 16.17.0 and newer.

The package manager selects a matching native binary when one is available.
Installing or importing the package does not compile native code.

<a id="compatibility-windows"></a>
### 6.1. Windows

Prebuilt binaries are available for x64, arm64, and x86 (`ia32`) Windows. For
x86, use a Node.js release that provides an x86 runtime.

Requests can fail with Libcurl Error 60 (`CURLE_PEER_FAILED_VERIFICATION`) when
the peer certificate cannot be verified. `rejectUnauthorized: false` disables
origin certificate and hostname verification and should only be used when that
trade-off is intentional.

<a id="compatibility-macos"></a>
### 6.2. macOS

Prebuilt binaries are available for Apple Silicon (`arm64`) and Intel (`x64`) macOS.

<a id="compatibility-linux"></a>
### 6.3. Linux

Prebuilt binaries are available for x64 and arm64 Linux on both glibc and musl.
GNU/Linux release binaries require GLIBC 2.31 or newer.

<a id="compatibility-building-from-source"></a>
### 6.4. Building from source

If a prebuilt binary is unavailable for your platform, or if optional
dependencies were intentionally omitted, build the installed package explicitly
using your package manager:

```text
npm exec --no -- sync-request-curl-build
pnpm exec sync-request-curl-build
yarn run sync-request-curl-build
```

Run the build with the same Node.js architecture that will use the library. Run
`sync-request-curl-build --help` for the current prerequisites.

Source builds keep the release defaults: macOS links the system libcurl, while
Linux and Windows build the libcurl bundled by `curl-sys`. Override that choice
explicitly when needed:

```sh
npm exec --no -- sync-request-curl-build --libcurl=system
npm exec --no -- sync-request-curl-build --libcurl=bundled
```

`--libcurl=system` is strict: if `curl-sys` cannot discover a compatible system
libcurl, the build fails instead of silently falling back to its bundled copy.
On Unix systems, system discovery uses the platform libcurl or `pkg-config`.
On Windows, `curl-sys` uses vcpkg. System builds inherit the capabilities and
TLS behaviour of the selected libcurl. `--libcurl=bundled` uses the pinned libcurl
shipped by `curl-sys` and retains the package's vendored build configuration.
The flag selects the libcurl implementation. Both modes continue to use
`curl-sys` as the Rust FFI layer.

Source builds require:

- Rust 1.88 or newer and Cargo
- Linux and other Unix systems: a C/C++ compiler, make, Perl, pkg-config, and
  CA certificates
- macOS: Xcode Command Line Tools
- Windows: Visual Studio C++ Build Tools and the Windows SDK for the target CPU
- Access to the locked Cargo dependencies, or an already populated Cargo cache

Other architectures and Unix platforms may work when Node.js, Rust, and the
required native dependencies support them, but they are not part of the
prebuilt release matrix.

Set `CARGO_BUILD_TARGET` when you need to select a Rust target explicitly. The
build must still run with a Node.js architecture compatible with the resulting
addon.

To use an externally managed native build, set `SYNC_REQUEST_CURL_NATIVE_PATH`
to the absolute path of its `.node` file.

<a id="caveats"></a>
## 7. Caveats

**sync-request-curl** was developed to improve performance with sending
synchronous requests in Node.js. It is also free from the
[sync-request](https://github.com/ForbesLindesay/sync-request) bug
which leaves an orphaned sync-rpc process, resulting in a [leaked handle being
detected in Jest](https://github.com/ForbesLindesay/sync-request/issues/129).

**sync-request-curl** was initially designed to work with UNIX-like systems for
UNSW students enrolled in [COMP1531 Software Engineering
Fundamentals](https://webcms3.cse.unsw.edu.au/COMP1531/23T2/outline). The
native distribution targets glibc- and musl-based Linux, Windows, and macOS on
the architectures listed in the compatibility section.

Please note that this library's primary goal is to simplify the learning of
JavaScript for novice programmers, hence its synchronous nature. However, we
recommend to always use an
[asynchronous alternative](https://blog.appsignal.com/2024/09/11/top-5-http-request-libraries-for-nodejs.html)
where possible.
