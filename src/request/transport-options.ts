import { isIP } from "node:net";
import { hasSafeAuthCredentials } from "#/http/auth";
import { prepareProxyOptions } from "#/request/proxy-options";
import type { Options } from "#/types/definition";

interface PreparedHttpAuthOptions {
  authType?: NonNullable<NonNullable<Options["auth"]>["type"]> | "bearer";
  authUsername?: string;
  authPassword?: string;
  authBearer?: string;
}

const assertSafeHttpCredentials = (
  username: string,
  password: string | undefined,
  type: string | undefined,
): void => {
  if (!hasSafeAuthCredentials(username, password, type)) {
    throw new TypeError(
      `Invalid HTTP credentials for ${type ?? "basic"} authentication`,
    );
  }
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
  assertSafeHttpCredentials(auth.username, auth.password, auth.type);
  return {
    authType: auth.type ?? "basic",
    authUsername: auth.username,
    authPassword: auth.password ?? "",
  };
};

const prepareTlsOptions = (tls?: Options["tls"]) => ({
  tlsCertFile: tls?.certFile,
  tlsCertType: tls?.certType,
  tlsKeyFile: tls?.keyFile,
  tlsKeyPassphrase: tls?.passphrase,
  tlsMinVersion: tls?.minVersion,
  tlsMaxVersion: tls?.maxVersion,
});

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
  if (options.localPortRange !== undefined) {
    if (options.localPort === undefined) {
      throw new TypeError("localPortRange requires localPort");
    }
    const attempts = Math.max(1, options.localPortRange);
    if (options.localPort + attempts - 1 > 65_535) {
      throw new TypeError("localPortRange must not extend beyond port 65535");
    }
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
  const preparedTls = prepareTlsOptions(options.tls);
  validateLocalBinding(options);
  const keepAlive = options.tcpKeepAlive;
  return {
    ...preparedProxy,
    ...preparedAuth,
    ...preparedTls,
    httpVersion: options.httpVersion ?? "auto",
    family: options.family ?? 0,
    rejectUnauthorized: options.rejectUnauthorized !== false,
    caFile: options.caFile,
    networkInterface: getNetworkInterface(options),
    localPort: options.localPort,
    localPortRange: options.localPortRange,
    maxDownloadSpeed: options.maxDownloadSpeed,
    maxUploadSpeed: options.maxUploadSpeed,
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
// security or transport policy. Per-transfer speed caps are intentionally not
// included: they do not alter response identity or connection compatibility.
const customPolicyKeys = [
  "auth",
  "proxy",
  "caFile",
  "tls",
  "localAddress",
  "localInterface",
  "localPort",
  "localPortRange",
] as const satisfies readonly (keyof Options)[];

export const usesCustomTransport = (options: Options): boolean => {
  if (customPolicyKeys.some((key) => options[key] !== undefined)) return true;
  if (options.rejectUnauthorized === false) return true;
  if (options.httpVersion !== undefined && options.httpVersion !== "auto") {
    return true;
  }
  if (options.family !== undefined && options.family !== 0) return true;
  return options.tcpKeepAlive !== undefined && options.tcpKeepAlive !== false;
};
