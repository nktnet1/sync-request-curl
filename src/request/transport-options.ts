import { isIP } from "node:net";
import { serializeRequestHeaders } from "#/http/headers";
import type { Options } from "#/types/definition";

interface PreparedProxyOptions {
  proxy: string;
  proxyUsername?: string;
  proxyPassword?: string;
  proxyAuth?: NonNullable<NonNullable<Options["proxy"]>["auth"]>;
  proxyNoProxy: string;
  proxyHeaders?: string[];
}

interface PreparedHttpAuthOptions {
  authType?: NonNullable<NonNullable<Options["auth"]>["type"]> | "bearer";
  authUsername?: string;
  authPassword?: string;
  authBearer?: string;
}

const HTTP_PROXY_PROTOCOLS = new Set(["http:", "https:"]);
const SOCKS_PROXY_PROTOCOLS = new Set([
  "socks4:",
  "socks4a:",
  "socks5:",
  "socks5h:",
]);

const prepareProxyOptions = (
  proxy?: Options["proxy"],
): PreparedProxyOptions => {
  if (proxy === undefined) {
    return { proxy: "", proxyNoProxy: "" };
  }

  const url = new URL(proxy.url);
  const isHttpProxy = HTTP_PROXY_PROTOCOLS.has(url.protocol);
  const isSocksProxy = SOCKS_PROXY_PROTOCOLS.has(url.protocol);
  const hasRootPath = isHttpProxy
    ? url.pathname === "/"
    : url.pathname === "" || url.pathname === "/";
  if (
    (!isHttpProxy && !isSocksProxy) ||
    !hasRootPath ||
    url.search ||
    url.hash
  ) {
    throw new TypeError(
      "proxy.url must be an HTTP(S) or SOCKS proxy origin URL",
    );
  }
  if (!isHttpProxy && proxy.auth !== undefined) {
    throw new TypeError("proxy.auth is only supported for HTTP(S) proxies");
  }
  if (!isHttpProxy && proxy.headers !== undefined) {
    throw new TypeError("proxy.headers are only supported for HTTP(S) proxies");
  }

  let proxyUsername: string | undefined;
  let proxyPassword: string | undefined;
  // Empty CURLOPT_PROXYUSERNAME/PROXYPASSWORD can enable Basic ':' auth.
  // Leave both unset unless the URL actually supplies credentials.
  if (url.username || url.password) {
    proxyUsername = decodeURIComponent(url.username);
    proxyPassword = decodeURIComponent(url.password);
    if (proxyUsername.includes("\0") || proxyPassword.includes("\0")) {
      throw new TypeError("Proxy credentials cannot contain NUL");
    }
  }

  if (proxy.password !== undefined && proxy.username === undefined) {
    throw new TypeError("proxy.password requires proxy.username");
  }
  if (proxy.username !== undefined) {
    proxyUsername = proxy.username;
    proxyPassword = proxy.password ?? "";
  }

  url.username = "";
  url.password = "";
  return {
    proxy: url.href,
    proxyUsername,
    proxyPassword,
    proxyAuth: proxy.auth,
    proxyNoProxy: proxy.noProxy?.join(",") ?? "",
    proxyHeaders:
      proxy.headers === undefined
        ? undefined
        : serializeRequestHeaders(proxy.headers),
  };
};

const prepareHttpAuthOptions = (
  auth?: Options["auth"],
): PreparedHttpAuthOptions => {
  if (auth === undefined) {
    return {};
  }
  if ("bearer" in auth) {
    return { authType: "bearer", authBearer: auth.bearer };
  }
  return {
    authType: auth.type ?? "basic",
    authUsername: auth.username,
    authPassword: auth.password ?? "",
  };
};

const validateLocalBinding = (options: Options): void => {
  if (options.localAddress !== undefined && isIP(options.localAddress) === 0) {
    throw new TypeError("localAddress must be an IP address");
  }
  if (
    options.localInterface !== undefined &&
    options.localAddress !== undefined
  ) {
    throw new TypeError("Use either localAddress or localInterface, not both");
  }
};

const getNetworkInterface = (options: Options): string | undefined => {
  if (options.localAddress !== undefined) {
    return `host!${options.localAddress}`;
  }
  if (options.localInterface !== undefined) {
    return `if!${options.localInterface}`;
  }
  return undefined;
};

/** Validate portable transport controls before cache lookup or native I/O. */
export const prepareTransportOptions = (options: Options) => {
  const preparedProxy = prepareProxyOptions(options.proxy);
  const preparedAuth = prepareHttpAuthOptions(options.auth);
  validateLocalBinding(options);
  const keepAlive = options.tcpKeepAlive;
  return {
    ...preparedProxy,
    ...preparedAuth,
    httpVersion: options.httpVersion ?? "auto",
    family: options.family ?? 0,
    rejectUnauthorized: options.rejectUnauthorized !== false,
    caFile: options.caFile,
    networkInterface: getNetworkInterface(options),
    tcpKeepAlive: keepAlive !== undefined && keepAlive !== false,
    tcpKeepIdle:
      typeof keepAlive === "object" ? keepAlive.idleSeconds : undefined,
    tcpKeepInterval:
      typeof keepAlive === "object" ? keepAlive.intervalSeconds : undefined,
    tcpKeepCount:
      typeof keepAlive === "object" ? keepAlive.probeCount : undefined,
  };
};

// Authentication and custom trust/routing/socket/protocol policy bypass
// persistent cache reuse and must not share sockets created under a different
// security or transport policy.
export const usesCustomTransport = (options: Options): boolean =>
  options.auth !== undefined ||
  options.proxy !== undefined ||
  options.rejectUnauthorized === false ||
  options.caFile !== undefined ||
  options.localAddress !== undefined ||
  options.localInterface !== undefined ||
  (options.httpVersion !== undefined && options.httpVersion !== "auto") ||
  (options.family !== undefined && options.family !== 0) ||
  (options.tcpKeepAlive !== undefined && options.tcpKeepAlive !== false);
