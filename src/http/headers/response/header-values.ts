const singletonResponseHeaders = new Set([
  "age",
  "authorization",
  "content-type",
  "etag",
  "expires",
  "from",
  "host",
  "if-modified-since",
  "if-unmodified-since",
  "last-modified",
  "location",
  "max-forwards",
  "proxy-authorization",
  "referer",
  "retry-after",
  "server",
  "user-agent",
]);

export const appendResponseHeader = (
  parsedHeaders: Map<string, string | string[]>,
  name: string,
  value: string,
): void => {
  if (name === "set-cookie") {
    const existingValue = parsedHeaders.get(name);
    if (existingValue === undefined) {
      parsedHeaders.set(name, [value]);
    } else {
      (existingValue as string[]).push(value);
    }
    return;
  }

  const existingValue = parsedHeaders.get(name);
  if (existingValue === undefined) {
    parsedHeaders.set(name, value);
    return;
  }

  if (name === "cookie") {
    parsedHeaders.set(name, `${existingValue as string}; ${value}`);
  } else if (!singletonResponseHeaders.has(name)) {
    parsedHeaders.set(name, `${existingValue as string}, ${value}`);
  }
};
