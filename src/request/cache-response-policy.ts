import { parseCacheControl, parseDeltaSeconds } from "#/request/cache-control";
import { type CacheableResponse, getHeaderValue } from "#/request/cache-types";
import { getVaryNamesFromHeaders } from "#/request/cache-variants";
import type { Response } from "#/types/definition";

const defaultCacheableStatusCodes = new Set([
  200, 203, 204, 300, 301, 308, 404, 405, 410, 414, 501,
]);

export const responseForbidsStorage = (headers: Response["headers"]): boolean =>
  parseCacheControl(getHeaderValue(headers, "cache-control")).has("no-store") ||
  getHeaderValue(headers, "set-cookie") !== undefined ||
  getVaryNamesFromHeaders(headers).includes("*");

export const canCacheResponse = (
  response: Pick<CacheableResponse, "statusCode" | "headers">,
): boolean => {
  if (responseForbidsStorage(response.headers)) return false;
  const cacheControl = parseCacheControl(
    getHeaderValue(response.headers, "cache-control"),
  );

  if (defaultCacheableStatusCodes.has(response.statusCode)) {
    return true;
  }

  const hasExplicitFreshness =
    parseDeltaSeconds(cacheControl.get("max-age")) !== undefined ||
    getHeaderValue(response.headers, "expires") !== undefined;
  // Partial and delta bodies cannot be reused as complete representations.
  return ![206, 226, 412].includes(response.statusCode) && hasExplicitFreshness;
};
