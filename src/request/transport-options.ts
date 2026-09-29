import { isIP } from "node:net";
import type { Options } from "#/types/definition";

interface PreparedProxyOptions {
  proxy: string;
  proxyUsername?: string;
  proxyPassword?: string;
}

const prepareProxyOptions = (
  proxy?: Options["proxy"],
): PreparedProxyOptions => {
  if (proxy === undefined) {
    return { proxy: "" };
  }

  const url = new URL(proxy.url);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new TypeError("proxy.url must be an HTTP(S) origin URL");
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
  return { proxy: url.href, proxyUsername, proxyPassword };
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
  const { proxy, proxyUsername, proxyPassword } = prepareProxyOptions(
    options.proxy,
  );
  validateLocalBinding(options);
  const keepAlive = options.tcpKeepAlive;
  return {
    proxy,
    proxyUsername,
    proxyPassword,
    rejectUnauthorized: options.rejectUnauthorized !== false,
    caFile: options.caFile,
    networkInterface: getNetworkInterface(options),
    tcpKeepAlive: keepAlive !== undefined && keepAlive !== false,
    tcpKeepIdle:
      typeof keepAlive === "object" ? keepAlive.idleSeconds : undefined,
    tcpKeepInterval:
      typeof keepAlive === "object" ? keepAlive.intervalSeconds : undefined,
  };
};

// Custom trust/routing/socket policy must not reuse sockets created under a
// different policy. Default Agents retain their existing pool semantics.
export const usesCustomTransport = (options: Options): boolean =>
  [
    options.proxy,
    options.rejectUnauthorized,
    options.caFile,
    options.localAddress,
    options.localInterface,
    options.tcpKeepAlive,
  ].some((value) => value !== undefined);
