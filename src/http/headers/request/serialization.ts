import { validateHeaderName, validateHeaderValue } from "node:http";
import { invalidRequestFraming } from "#/http/headers/request/framing";
import { hasRequestHeader } from "#/http/headers/request/headers";
import type { Options } from "#/types/definition";

/**
 * Converts Node-style request headers into the line format used by the native
 * transport.
 */
const invalidHostHeaderArray = (): never => {
  const error = new TypeError(
    'The "options.headers.host" property must be of type string. Received an instance of Array',
  ) as TypeError & { code?: string };
  error.code = "ERR_INVALID_ARG_TYPE";
  throw error;
};

const formatRequestHeader = (name: string, value: string): string =>
  value === "" ? `${name};` : `${name}: ${value}`;

const serializeRequestHeaderArray = (
  name: string,
  normalizedName: string,
  values: string[],
): string[] => {
  if (normalizedName === "host") {
    invalidHostHeaderArray();
  }

  for (const value of values) {
    validateHeaderValue(name, value);
  }

  if (normalizedName === "cookie") {
    return values.length === 0 ? [] : [`${name}: ${values.join("; ")}`];
  }

  return values.map((value) => formatRequestHeader(name, value));
};

function validateRequestHeaderValue(
  name: string,
  value: string | undefined,
): asserts value is string {
  // `Headers` permits undefined values, but Node rejects them outbound.
  validateHeaderValue(name, value as string);
}

const serializeRequestHeaderValue = (
  name: string,
  value: string | undefined,
): string[] => {
  validateRequestHeaderValue(name, value);
  return [formatRequestHeader(name, value)];
};

export const serializeRequestHeaders = (
  headers?: NonNullable<Options["headers"]>,
): string[] => {
  if (!headers) {
    return [];
  }

  const serialized: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    validateHeaderName(name);
    const normalizedName = name.toLowerCase();
    serialized.push(
      ...(Array.isArray(value)
        ? serializeRequestHeaderArray(name, normalizedName, value)
        : serializeRequestHeaderValue(name, value)),
    );
  }
  return serialized;
};

const originSensitiveProxyHeaders = new Set(["authorization", "cookie"]);

/** Proxy header lists must not override origin framing or carry origin secrets. */
export const serializeProxyHeaders = (
  headers: NonNullable<Options["headers"]>,
): string[] => {
  const serialized = serializeRequestHeaders(headers);
  if (
    hasRequestHeader(serialized, "content-length") ||
    hasRequestHeader(serialized, "transfer-encoding")
  ) {
    invalidRequestFraming(
      "Content-Length and Transfer-Encoding cannot be supplied in proxy.headers",
    );
  }
  for (const name of originSensitiveProxyHeaders) {
    if (hasRequestHeader(serialized, name)) {
      throw new TypeError(
        "Authorization and Cookie cannot be supplied in proxy.headers",
      );
    }
  }
  return serialized;
};
