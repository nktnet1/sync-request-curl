import { hasSafeAuthCredentials, hasSafeOpaqueCredentials } from "#/http/auth";
import { hasRequestHeader, serializeProxyHeaders } from "#/http/headers";
import type { Options } from "#/types/definition";

interface PreparedProxyOptions {
  proxy: string;
  proxyUsername?: string;
  proxyPassword?: string;
  proxyAuth?: NonNullable<NonNullable<Options["proxy"]>["auth"]>;
  proxyNoProxy: string;
  proxyHeaders?: string[];
}

const HTTP_PROXY_PROTOCOLS = new Set(["http:", "https:"]);
const SOCKS_PROXY_PROTOCOLS = new Set([
  "socks4:",
  "socks4a:",
  "socks5:",
  "socks5h:",
]);

const assertSafeProxyCredentials = (
  username: string,
  password: string | undefined,
  auth: string | undefined,
  isHttpProxy: boolean,
): void => {
  const valid = isHttpProxy
    ? hasSafeAuthCredentials(username, password, auth)
    : hasSafeOpaqueCredentials(username, password);
  if (!valid) {
    throw new TypeError("Invalid proxy credentials");
  }
};

const validateProxyAuthorizationHeader = (
  proxyHeaders: string[] | undefined,
  hasStructuredProxyAuth: boolean,
): void => {
  if (
    hasStructuredProxyAuth &&
    proxyHeaders !== undefined &&
    hasRequestHeader(proxyHeaders, "proxy-authorization")
  ) {
    throw new TypeError(
      "Proxy-Authorization cannot be combined with structured proxy authentication",
    );
  }
};

const readProxyUrlCredentials = (
  url: URL,
  auth: string | undefined,
  isHttpProxy: boolean,
): Pick<PreparedProxyOptions, "proxyUsername" | "proxyPassword"> => {
  const proxyUsername = decodeURIComponent(url.username);
  const proxyPassword = decodeURIComponent(url.password);
  assertSafeProxyCredentials(proxyUsername, proxyPassword, auth, isHttpProxy);
  return { proxyUsername, proxyPassword };
};

const hasProxyUrlCredentials = (
  proxyUrl: string,
  isHttpProxy: boolean,
): boolean => {
  // WHATWG drops empty userinfo. Preserve its marker using the same ignored
  // whitespace and authority delimiters as the parser, including HTTP's '\\'.
  const normalized = proxyUrl.replace(/[\t\r\n]/g, "");
  const authority = normalized
    .slice(normalized.indexOf(":") + 1)
    .replace(isHttpProxy ? /^[\\/]+/ : /^\/+/, "")
    .split(isHttpProxy ? /[\\/?#]/ : /[/?#]/, 1)[0];
  return authority.includes("@");
};

const parseProxyUrl = (
  proxyUrl: string,
): { url: URL; isHttpProxy: boolean; hasCredentials: boolean } => {
  const url = new URL(proxyUrl);
  const isHttpProxy = HTTP_PROXY_PROTOCOLS.has(url.protocol);
  const isSocksProxy = SOCKS_PROXY_PROTOCOLS.has(url.protocol);
  const hasRootPath = isHttpProxy
    ? url.pathname === "/"
    : ["", "/"].includes(url.pathname);
  const allowedProtocol = isHttpProxy || isSocksProxy;
  const hasPathExtras = Boolean(url.search || url.hash);
  if (!allowedProtocol || !hasRootPath || hasPathExtras) {
    throw new TypeError(
      "proxy.url must be an HTTP(S) or SOCKS proxy origin URL",
    );
  }
  return {
    url,
    isHttpProxy,
    hasCredentials: hasProxyUrlCredentials(proxyUrl, isHttpProxy),
  };
};

export const prepareProxyOptions = (
  proxy?: Options["proxy"],
): PreparedProxyOptions => {
  if (proxy === undefined) {
    return { proxy: "", proxyNoProxy: "" };
  }

  const { url, isHttpProxy, hasCredentials } = parseProxyUrl(proxy.url);
  if (!isHttpProxy && proxy.auth !== undefined) {
    throw new TypeError("proxy.auth is only supported for HTTP(S) proxies");
  }
  if (!isHttpProxy && proxy.headers !== undefined) {
    throw new TypeError("proxy.headers are only supported for HTTP(S) proxies");
  }

  if (proxy.password !== undefined && proxy.username === undefined) {
    throw new TypeError("proxy.password requires proxy.username");
  }
  let proxyUsername: string | undefined;
  let proxyPassword: string | undefined;
  if (proxy.username !== undefined) {
    proxyUsername = proxy.username;
    proxyPassword = proxy.password ?? "";
    assertSafeProxyCredentials(
      proxyUsername,
      proxyPassword,
      proxy.auth,
      isHttpProxy,
    );
  } else if (hasCredentials) {
    // Explicit credentials replace both URL fields. Discarded userinfo must
    // not be decoded or validated before that replacement takes effect.
    ({ proxyUsername, proxyPassword } = readProxyUrlCredentials(
      url,
      proxy.auth,
      isHttpProxy,
    ));
  }

  const proxyHeaders =
    proxy.headers === undefined
      ? undefined
      : serializeProxyHeaders(proxy.headers);
  validateProxyAuthorizationHeader(
    proxyHeaders,
    proxyUsername !== undefined || proxy.auth !== undefined,
  );

  url.username = "";
  url.password = "";
  return {
    proxy: url.href,
    proxyUsername,
    proxyPassword,
    proxyAuth: proxy.auth,
    proxyNoProxy: proxy.noProxy?.join(",") ?? "",
    proxyHeaders,
  };
};
