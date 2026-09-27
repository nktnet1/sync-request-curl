import { isIP } from "node:net";
import type { Options } from "#/types";

/** Validate portable transport controls before cache lookup or native I/O. */
export const prepareTransportOptions = (options: Options) => {
  let proxy = "";
  let proxyUsername: string | undefined;
  let proxyPassword: string | undefined;
  if (options.proxy !== undefined) {
    const url = new URL(options.proxy);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new TypeError("proxy must be an HTTP(S) origin URL");
    }
    // Empty CURLOPT_PROXYUSERNAME/PROXYPASSWORD can enable Basic ':' auth.
    // Leave both unset unless the URL actually supplies credentials.
    if (url.username || url.password) {
      proxyUsername = decodeURIComponent(url.username);
      proxyPassword = decodeURIComponent(url.password);
      if (proxyUsername.includes("\0") || proxyPassword.includes("\0")) {
        throw new TypeError("Proxy credentials cannot contain NUL");
      }
    }
    url.username = "";
    url.password = "";
    proxy = url.href;
  }
  if (options.proxyAuth !== undefined) {
    if (!proxy) throw new TypeError("proxyAuth requires proxy");
    proxyUsername = options.proxyAuth.username;
    proxyPassword = options.proxyAuth.password;
  }
  if (options.localAddress !== undefined && isIP(options.localAddress) === 0) {
    throw new TypeError("localAddress must be an IP address");
  }
  if (
    options.localInterface !== undefined &&
    options.localAddress !== undefined
  ) {
    throw new TypeError("Use either localAddress or localInterface, not both");
  }
  const keepAlive = options.tcpKeepAlive;
  return {
    proxy,
    proxyUsername,
    proxyPassword,
    rejectUnauthorized: options.rejectUnauthorized !== false,
    caFile: options.caFile,
    networkInterface:
      options.localAddress === undefined
        ? options.localInterface === undefined
          ? undefined
          : `if!${options.localInterface}`
        : `host!${options.localAddress}`,
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
