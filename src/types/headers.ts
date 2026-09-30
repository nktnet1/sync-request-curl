import type { IncomingHttpHeaders } from "node:http";

/**
 * HTTP header map used by `then-request`.
 *
 * This is an alias of Node.js' {@linkcode IncomingHttpHeaders}, exposed under
 * the historical `then-request` name so consumers do not need to import Node's
 * type directly.
 *
 * @group Request
 */
export type Headers = IncomingHttpHeaders;
